$ = (_) -> document.getElementById _

init = (controlType, quality, hud, godmode) ->
  hexGL = new bkcore.hexgl.HexGL(
    document: document
    width: window.innerWidth
    height: window.innerHeight
    container: $ 'main'
    overlay: $ 'overlay'
    gameover: $ 'step-5'
    quality: quality
    difficulty: 0
    hud: hud is 1
    controlType: controlType
    godmode: godmode
    track: 'Cityscape'
  )
  window.hexGL=hexGL

  progressbar = $ 'progressbar'
  hexGL.load(
    onLoad: ->
      console.log 'LOADED.'
      # Stop landing page reader if running, ShipControls will take over
      stopReader = ->
        new Promise (resolve, reject) ->
          if window.serialReader
            try
              releasePromise = window.serialReader.releaseLock()
              if releasePromise and typeof releasePromise.then is 'function'
                releasePromise.catch(->).then ->
                  window.serialReader = null
                  # Additional check: wait a bit if stream is still locked
                  if window.serialPort and window.serialPort.readable
                    attempts = 0
                    checkLock = ->
                      if attempts < 20 and window.serialPort.readable.locked
                        attempts++
                        setTimeout checkLock, 10
                      else
                        resolve()
                    checkLock()
                  else
                    resolve()
              else
                window.serialReader = null
                resolve()
            catch e
              # Ignore errors, may already be released
              window.serialReader = null
              resolve()
          else
            resolve()
      
      # Wait for reader to be released, then start game
      stopReader().then ->
        hexGL.init()
        $('step-3').style.display = 'none'
        $('step-4').style.display = 'block'
        # ShipControls will automatically use global port if available
        hexGL.start()
      .catch (error) ->
        console.error 'Error stopping reader:', error
        # Start anyway
        hexGL.init()
        $('step-3').style.display = 'none'
        $('step-4').style.display = 'block'
        hexGL.start()
    onError: (s) ->
      console.error "Error loading #{ s }."
    onProgress: (p, t, n) ->
      console.log("LOADED "+t+" : "+n+" ( "+p.loaded+" / "+p.total+" ).")
      progressbar.style.width = "#{ p.loaded / p.total * 100 }%"
  )

u = bkcore.Utils.getURLParameter

# Only show CONTROL: AI CAMERA button, set defaults for others
defaultControls = 0  # AI CAMERA
defaultQuality = 3   # HIGH
defaultGodmode = 0   # OFF

s = [
  ['controlType', ['AI CAMERA', 'TOUCH', 'LEAP MOTION CONTROLLER',
    'GAMEPAD'], defaultControls, defaultControls, 'Controls: ']
]
for a in s
  do(a)->
    a[3] = u(a[0]) ? a[2]
    e = $ "s-#{a[0]}"
    (f = -> e.innerHTML = a[4]+a[1][a[3]])()
    # controlType is fixed to AI CAMERA, no onclick handler
    if a[0] isnt 'controlType'
      e.onclick = -> f(a[3] = (a[3]+1)%a[1].length)

# Serial protocol constants and classes (from ShipControls.js)
HEXGL_MESSAGE_HEAD_CODE = 0xFD
HEXGL_MESSAGE_END_CODE = 0xED

HexglMessageCommand =
  KEYPOINT_BOX_DETECTION: 0
  CLASSIFICATION: 1
  DETECTION: 2

HexglReceiveState =
  WAIT_START: 0
  HEAD: 1
  DATA: 2
  CRC: 3
  END: 4

# HexglAiCamProtocol class (from ShipControls.js)
class HexglAiCamProtocol
  constructor: ->
    @state = HexglReceiveState.WAIT_START
    @currentMessage = null
    @receiveBuffer = []

  feedByte: (byte) ->
    switch @state
      when HexglReceiveState.WAIT_START
        if byte is HEXGL_MESSAGE_HEAD_CODE
          @currentMessage =
            head: { head: byte, cmd: 0, length: 0 }
            data: []
            crc: 0
            end: 0
          @receiveBuffer = []
          @state = HexglReceiveState.HEAD
        break

      when HexglReceiveState.HEAD
        @receiveBuffer.push byte
        if @receiveBuffer.length is 3
          @currentMessage.head.cmd = @receiveBuffer[0]
          @currentMessage.head.length = @receiveBuffer[1] | (@receiveBuffer[2] << 8)
          @receiveBuffer = []
          @state = HexglReceiveState.DATA
        break

      when HexglReceiveState.DATA
        @receiveBuffer.push byte
        if @receiveBuffer.length is @currentMessage.head.length
          @currentMessage.data = @receiveBuffer.slice 0
          @receiveBuffer = []
          @state = HexglReceiveState.CRC
        break

      when HexglReceiveState.CRC
        @receiveBuffer.push byte
        if @receiveBuffer.length is 4
          @currentMessage.crc = @receiveBuffer[0] |
            (@receiveBuffer[1] << 8) |
            (@receiveBuffer[2] << 16) |
            (@receiveBuffer[3] << 24)
          @receiveBuffer = []
          @state = HexglReceiveState.END
        break

      when HexglReceiveState.END
        if byte is HEXGL_MESSAGE_END_CODE
          @state = HexglReceiveState.WAIT_START
          @currentMessage.end = byte
          return @currentMessage
        break

    null

  reset: ->
    @state = HexglReceiveState.WAIT_START
    @currentMessage = null
    @receiveBuffer = []

# Web Serial connection handler - use global variable to persist across pages
window.serialPort = window.serialPort or null
window.serialReader = window.serialReader or null
window.serialProtocol = window.serialProtocol or new HexglAiCamProtocol()

updateSerialButtonText = ->
  hudButton = $ 's-hud'
  if hudButton and window.serialPort and window.serialPort.readable
    hudButton.innerHTML = 'Web Serial: Connected'
  else if hudButton
    hudButton.innerHTML = 'Web Serial'

# Handle parsed serial message (from ShipControls.js)
handleSerialMessage = (msg) ->
  if not msg or not msg.head
    return

  # If game has started, use ShipControls for handling
  if window.hexGL and window.hexGL.components and window.hexGL.components.shipControls
    shipControls = window.hexGL.components.shipControls
    
    # CLASSIFICATION message
    if msg.head.cmd is HexglMessageCommand.CLASSIFICATION
      type = if msg.data and msg.data.length > 0 then msg.data[0] else null
      i = 1
      while i < msg.head.length
        id = msg.data[i]
        confidence = msg.data[i + 1]
        if typeof id isnt 'undefined'
          # Log to ShipControls debug UI
          shipControls.logSerialParsedMessage
            source: 'classification'
            type: type
            id: id
            confidence: confidence
            action: shipControls.getSerialActionLabel id
          # Execute game action
          shipControls.handleSerialAction id, confidence
        i += 2

    # DETECTION message
    else if msg.head.cmd is HexglMessageCommand.DETECTION
      dtype = if msg.data and msg.data.length > 0 then msg.data[0] else null
      j = 1
      while j < msg.head.length
        if j + 5 >= msg.head.length
          break
        did = msg.data[j]
        dconfidence = msg.data[j + 5]
        if typeof did isnt 'undefined'
          # Log to ShipControls debug UI
          shipControls.logSerialParsedMessage
            source: 'detection'
            type: dtype
            id: did
            confidence: dconfidence
            centroid: { x: msg.data[j + 1], y: msg.data[j + 2] }
            size: { w: msg.data[j + 3], h: msg.data[j + 4] }
            action: shipControls.getSerialActionLabel did
          # Execute game action
          shipControls.handleSerialAction did, dconfidence
        j += 6
  else
    # Game not started yet, just log to console
    if msg.head.cmd is HexglMessageCommand.CLASSIFICATION
      type = if msg.data and msg.data.length > 0 then msg.data[0] else null
      i = 1
      while i < msg.head.length
        id = msg.data[i]
        confidence = msg.data[i + 1]
        if typeof id isnt 'undefined'
          console.log 'Serial Classification:', { type: type, id: id, confidence: confidence }
        i += 2
    else if msg.head.cmd is HexglMessageCommand.DETECTION
      dtype = if msg.data and msg.data.length > 0 then msg.data[0] else null
      j = 1
      while j < msg.head.length
        if j + 5 >= msg.head.length
          break
        did = msg.data[j]
        dconfidence = msg.data[j + 5]
        if typeof did isnt 'undefined'
          console.log 'Serial Detection:', {
            type: dtype
            id: did
            confidence: dconfidence
            centroid: { x: msg.data[j + 1], y: msg.data[j + 2] }
            size: { w: msg.data[j + 3], h: msg.data[j + 4] }
          }
        j += 6

# Start reading from serial port if already connected
window.startSerialReading = startSerialReading = ->
  if window.serialPort and window.serialPort.readable and not window.serialReader
    try
      # Reset protocol state
      window.serialProtocol.reset()
      window.serialReader = window.serialPort.readable.getReader()
      console.log 'Serial reader recreated for game'
      
      readLoop = ->
        window.serialReader.read()
          .then ({ value, done }) ->
            if done
              if window.serialReader
                try
                  releasePromise = window.serialReader.releaseLock()
                  if releasePromise and typeof releasePromise.catch is 'function'
                    releasePromise.catch ->
                catch e
                  # Ignore errors
                window.serialReader = null
              return
            if value
              # Parse bytes using protocol (from ShipControls.js)
              # If game started, let ShipControls handle it (it will use its own reader)
              # Otherwise, handle here for landing page
              if window.hexGL and window.hexGL.components and window.hexGL.components.shipControls
                # Game started, reader should be stopped, but if still running, stop it
                return
              for k in [0...value.length]
                byte = value[k]
                # Log raw byte if ShipControls is available
                if window.hexGL and window.hexGL.components and window.hexGL.components.shipControls
                  window.hexGL.components.shipControls.logSerialRawByte byte
                message = window.serialProtocol.feedByte byte
                if message
                  handleSerialMessage message
            if window.serialReader
              readLoop()
          .catch (error) ->
            # NetworkError usually means device was disconnected
            if error.name is 'NetworkError' or (error.message and error.message.includes 'device has been lost')
              console.warn 'Serial device disconnected:', error.message || error
              if window.serialReader
                try
                  releasePromise = window.serialReader.releaseLock()
                  if releasePromise and typeof releasePromise.catch is 'function'
                    releasePromise.catch ->
                catch e
                  # Ignore errors
                window.serialReader = null
              # Reset protocol on disconnect
              window.serialProtocol.reset()
              # Don't try to reconnect if device is lost
              return
            console.error 'Read error:', error
            if window.serialReader
              try
                releasePromise = window.serialReader.releaseLock()
                if releasePromise and typeof releasePromise.catch is 'function'
                  releasePromise.catch ->
              catch e
                # Ignore errors
              window.serialReader = null
            # Reset protocol on error
            window.serialProtocol.reset()
            # Try to reconnect if port is still open (only for non-fatal errors)
            if window.serialPort and window.serialPort.readable
              try
                window.serialProtocol.reset()
                window.serialReader = window.serialPort.readable.getReader()
                readLoop()
              catch e
                console.error 'Failed to recreate reader:', e
      
      readLoop()
    catch e
      console.error 'Failed to create serial reader:', e

# Update button text on page load if already connected
updateSerialButtonText()

$('s-hud').onclick = ->
  if not navigator.serial
    alert 'Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera.'
    return
  
  if window.serialPort and window.serialPort.readable
    # Already connected, close connection
    if window.serialReader
      window.serialReader.releaseLock().catch ->
      window.serialReader = null
    window.serialPort.close()
    window.serialPort = null
    updateSerialButtonText()
    console.log 'Serial port closed'
  else
    # Request port and connect
    navigator.serial.requestPort()
      .then (port) ->
        window.serialPort = port
        # Open with default baud rate 9600
        port.open { baudRate: 9600 }
          .then ->
            updateSerialButtonText()
            console.log 'Serial port opened successfully'
            # Reset protocol on new connection
            window.serialProtocol.reset()
            startSerialReading()
          .catch (error) ->
            console.error 'Error opening serial port:', error
            alert 'Failed to open serial port: ' + error.message
            window.serialPort = null
            updateSerialButtonText()
      .catch (error) ->
        if error.name is 'NotFoundError'
          console.log 'No port selected'
        else
          console.error 'Error with serial port:', error
          alert 'Failed to connect to serial port: ' + (error.message || error.toString())
$('step-2').onclick = ->
  $('step-2').style.display = 'none'
  $('step-3').style.display = 'block'
  # hud parameter: default to 1 (ON) since we removed the toggle
  defaultHud = 1
  init s[0][3], defaultQuality, defaultHud, defaultGodmode
$('step-5').onclick = ->
  window.location.reload()
# RANKING button handler
$('s-ranking').onclick = ->
  $('step-1').style.display = 'none'
  $('ranking').style.display = 'block'
  # Get best times and display
  if window.hexGL
    rankingList = $ 'ranking-list'
    if rankingList
      lines = window.hexGL.buildBestTimesLines true
      rankingList.textContent = lines.join '\n'
  else
    # HexGL not initialized yet, create temporary instance for best times
    tempHexGL = new bkcore.hexgl.HexGL(
      document: document
      track: 'Cityscape'
      difficulty: 0
    )
    rankingList = $ 'ranking-list'
    if rankingList
      lines = tempHexGL.buildBestTimesLines true
      rankingList.textContent = lines.join '\n'

$('ranking').onclick = ->
  $('step-1').style.display = 'block'
  $('ranking').style.display = 'none'

# HELP button handler
$('s-help').onclick = ->
  $('step-1').style.display = 'none'
  $('help').style.display = 'block'
  helpContainer = $ 'help-image-container'
  if helpContainer
    helpContainer.style.backgroundImage = 'url(css/help-0.png)'

$('help').onclick = ->
  $('step-1').style.display = 'block'
  $('help').style.display = 'none'

hasWebGL = ->
  gl = null
  canvas = document.createElement('canvas');
  try
    gl = canvas.getContext("webgl")
  if not gl?
    try
      gl = canvas.getContext("experimental-webgl")
  return gl?

if not hasWebGL()
  getWebGL = $('start')
  getWebGL.innerHTML = 'WebGL is not supported!'
  getWebGL.onclick = ->
    window.location.href = 'http://get.webgl.org/'
else
  $('start').onclick = ->
    $('step-1').style.display = 'none'
    $('step-2').style.display = 'block'
    $('step-2').style.backgroundImage = "url(css/help-#{s[0][3]}.png)"
