-- Pokémon Emerald (JP) reading-assistant bridge for mGBA.
--
-- Each frame (throttled), reads the game's dialogue buffer gStringVar4 from EWRAM,
-- decodes the Gen-3 Japanese text, and — when it changes — sends it as JSON over TCP
-- to the companion reader (which shows romaji + English).
--
-- Setup in mGBA:  Tools → Scripting → Load script → select THIS file.
--                 (keep charmap_jp.lua in the SAME folder — it is loaded via require)
-- Watch the Scripting console for "[bridge] connected" and the decoded lines.

local ok, charmap = pcall(require, "charmap_jp")
if not ok then
  console:error("[bridge] could not load charmap_jp.lua — keep it in the same folder as this script.")
  console:error("[bridge] (run `npm run setup` or `node scripts/build-charmap.mjs` to generate it)")
  return
end

-- gStringVar4 for the JP retail ROM (pinned by rom_jp.sha1; the unique 1000-byte EWRAM
-- buffer, symbol gUnknown_2021C7C in pret/pokeemerald-jp's sym_ewram_jp.txt).
local GSTRINGVAR4 = 0x02021C7C
local BUFLEN = 1000

local HOST = "127.0.0.1"
local PORT = 8081
local POLL_EVERY = 8 -- frames between polls (~7-8 Hz at 60fps)

local sock = nil
local connected = false
local lastSent = nil
local frame = 0
local cooldown = 0

local function disconnect()
  if sock then pcall(function() sock:close() end) end
  sock = nil
  connected = false
end

local function tryConnect()
  if connected then return end
  if cooldown > 0 then cooldown = cooldown - 1; return end
  local s = socket.connect(HOST, PORT)
  if s then
    sock = s
    connected = true
    -- drop the connection if the reader goes away
    if s.add then
      s:add("error", function() disconnect() end)
    end
    console:log("[bridge] connected to reader at " .. HOST .. ":" .. PORT)
  else
    cooldown = 90 -- ~1.5s before retrying
  end
end

-- JSON-encode a UTF-8 string (escape control chars, quote, backslash; pass UTF-8 through).
local function jsonString(s)
  local out = s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"'
    elseif c == '\\' then return '\\\\'
    elseif c == '\n' then return '\\n'
    elseif c == '\r' then return '\\r'
    elseif c == '\t' then return '\\t'
    else return string.format('\\u%04x', string.byte(c)) end
  end)
  return '"' .. out .. '"'
end

local function readBuffer()
  local data = emu:readRange(GSTRINGVAR4, BUFLEN)
  if not data or #data == 0 then return nil end
  local bytes = {}
  for i = 1, #data do bytes[i] = data:byte(i) end
  return bytes
end

local function trim(s)
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

callbacks:add("frame", function()
  frame = frame + 1
  if frame % POLL_EVERY ~= 0 then return end

  tryConnect()
  if not connected then return end

  local okRead, bytes = pcall(readBuffer)
  if not okRead or not bytes then return end

  local jp = trim(charmap.decode(bytes, BUFLEN))
  if jp == "" or jp == lastSent then return end
  lastSent = jp

  local payload = '{"src":"dialog","japanese":' .. jsonString(jp) .. "}\n"
  local sent = pcall(function() return sock:send(payload) end)
  if not sent then
    disconnect()
  else
    console:log("[bridge] " .. (jp:gsub("\n", " ")))
  end
end)

console:log("[bridge] loaded. Waiting to connect to the reader (start it with `npm start`).")
