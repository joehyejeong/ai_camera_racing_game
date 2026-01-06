/*
* HexGL
* @author Thibaut 'BKcore' Despoulain <http://bkcore.com>
* @license This work is licensed under the Creative Commons Attribution-NonCommercial 3.0 Unported License.
*          To view a copy of this license, visit http://creativecommons.org/licenses/by-nc/3.0/.
*/

var bkcore = bkcore || {};
bkcore.hexgl = bkcore.hexgl || {};

// 시리얼 통신 프로토콜 상수 및 클래스
var HEXGL_MESSAGE_HEAD_CODE = 0xFD;
var HEXGL_MESSAGE_END_CODE = 0xED;

var HexglMessageCommand = {
    KEYPOINT_BOX_DETECTION: 0,
    CLASSIFICATION: 1,
    DETECTION: 2
};

var HexglReceiveState = {
    WAIT_START: 0,
    HEAD: 1,
    DATA: 2,
    CRC: 3,
    END: 4
};

var HexglAiCamProtocol = function () {
    this.state = HexglReceiveState.WAIT_START;
    this.currentMessage = null;
    this.receiveBuffer = [];
};

HexglAiCamProtocol.prototype.feedByte = function (byte) {
    switch (this.state) {
        case HexglReceiveState.WAIT_START:
            if (byte === HEXGL_MESSAGE_HEAD_CODE) {
                this.currentMessage = {
                    head: { head: byte, cmd: 0, length: 0 },
                    data: [],
                    crc: 0,
                    end: 0
                };
                this.receiveBuffer = [];
                this.state = HexglReceiveState.HEAD;
            }
            break;

        case HexglReceiveState.HEAD:
            this.receiveBuffer.push(byte);
            if (this.receiveBuffer.length === 3) {
                this.currentMessage.head.cmd = this.receiveBuffer[0];
                this.currentMessage.head.length = this.receiveBuffer[1] | (this.receiveBuffer[2] << 8);
                this.receiveBuffer = [];
                this.state = HexglReceiveState.DATA;
            }
            break;

        case HexglReceiveState.DATA:
            this.receiveBuffer.push(byte);
            if (this.receiveBuffer.length === this.currentMessage.head.length) {
                this.currentMessage.data = this.receiveBuffer.slice(0);
                this.receiveBuffer = [];
                this.state = HexglReceiveState.CRC;
            }
            break;

        case HexglReceiveState.CRC:
            this.receiveBuffer.push(byte);
            if (this.receiveBuffer.length === 4) {
                this.currentMessage.crc = this.receiveBuffer[0] |
                    (this.receiveBuffer[1] << 8) |
                    (this.receiveBuffer[2] << 16) |
                    (this.receiveBuffer[3] << 24);
                this.receiveBuffer = [];
                this.state = HexglReceiveState.END;
            }
            break;

        case HexglReceiveState.END:
            if (byte === HEXGL_MESSAGE_END_CODE) {
                this.state = HexglReceiveState.WAIT_START;
                this.currentMessage.end = byte;
                return this.currentMessage;
            }
            break;
    }

    return null;
};

HexglAiCamProtocol.prototype.reset = function () {
    this.state = HexglReceiveState.WAIT_START;
    this.currentMessage = null;
    this.receiveBuffer = [];
};

bkcore.hexgl.ShipControls = function (ctx) {
    var self = this;
    var domElement = ctx.document;

    this.active = true;
    this.destroyed = false;
    this.falling = false;

    this.dom = domElement;
    this.mesh = null;

    this.epsilon = 0.00000001;
    this.zero = new THREE.Vector3(0, 0, 0);
    this.airResist = 0.02;
    this.airDrift = 0.1;
    this.thrust = 0.02;
    this.airBrake = 0.02;
    this.maxSpeed = 7.0;
    this.boosterSpeed = this.maxSpeed * 0.2;
    this.boosterDecay = 0.01;
    this.angularSpeed = 0.005;
    this.airAngularSpeed = 0.0065;
    this.repulsionRatio = 0.5;
    this.repulsionCap = 2.5;
    this.repulsionLerp = 0.1;
    this.collisionSpeedDecrease = 0.8;
    this.collisionSpeedDecreaseCoef = 0.8;
    this.maxShield = 1.0;
    this.shieldDelay = 60;
    this.shieldTiming = 0;
    this.shieldDamage = 0.25;
    this.driftLerp = 0.35;
    this.angularLerp = 0.35;

    this.movement = new THREE.Vector3(0, 0, 0);
    this.rotation = new THREE.Vector3(0, 0, 0);
    this.roll = 0.0;
    this.rollAxis = new THREE.Vector3();
    this.drift = 0.0;
    this.speed = 0.0;
    this.speedRatio = 0.0;
    this.boost = 0.0;
    this.shield = 1.0;
    this.angular = 0.0;

    this.currentVelocity = new THREE.Vector3();

    this.quaternion = new THREE.Quaternion();

    this.dummy = new THREE.Object3D();
    this.dummy.useQuaternion = true;

    this.collisionMap = null;
    this.collisionPixelRatio = 1.0;
    this.collisionDetection = false;
    this.collisionPreviousPosition = new THREE.Vector3();

    this.heightMap = null;
    this.heightPixelRatio = 1.0;
    this.heightBias = 0.0;
    this.heightLerp = 0.4;
    this.heightScale = 1.0;

    this.rollAngle = 0.6;
    this.rollLerp = 0.08;
    this.rollDirection = new THREE.Vector3(0, 0, 1);

    this.gradient = 0.0;
    this.gradientTarget = 0.0;
    this.gradientLerp = 0.05;
    this.gradientScale = 4.0;
    this.gradientVector = new THREE.Vector3(0, 0, 5);
    this.gradientAxis = new THREE.Vector3(1, 0, 0);

    this.tilt = 0.0;
    this.tiltTarget = 0.0;
    this.tiltLerp = 0.05;
    this.tiltScale = 4.0;
    this.tiltVector = new THREE.Vector3(5, 0, 0);
    this.tiltAxis = new THREE.Vector3(0, 0, 1);

    this.repulsionVLeft = new THREE.Vector3(1, 0, 0);
    this.repulsionVRight = new THREE.Vector3(-1, 0, 0);
    this.repulsionVFront = new THREE.Vector3(0, 0, 1);
    this.repulsionVScale = 4.0;
    this.repulsionAmount = 0.0;
    this.repulsionForce = new THREE.Vector3();

    this.fallVector = new THREE.Vector3(0, -20, 0);

    this.resetPos = null;
    this.resetRot = null;

    this.key = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        ltrigger: false,
        rtrigger: false,
        use: false
    };

    this.collision = {
        front: false,
        left: false,
        right: false
    };

    this.touchController = null;
    this.orientationController = null;
    this.gamepadController = null;

    // 시리얼 컨트롤 초기화
    this.serialControl = {
        protocol: new HexglAiCamProtocol(),
        port: null,
        reader: null,
        isConnecting: false,
        isConnected: false,
        timers: {},
        stopRequested: false,
        interactionHandler: null,
        debug: {
            raw: [],
            parsed: []
        },
        debugElements: null
    };

    // 기존 컨트롤러 설정 (터치, 방향, 게임패드, Leap Motion)
    if (ctx.controlType == 1 && bkcore.controllers.TouchController.isCompatible()) {
        this.touchController = new bkcore.controllers.TouchController(
            domElement, ctx.width / 2,
            function (state, touch, event) {
                if (event.touches.length >= 4)
                    window.location.reload(false);
                else if (event.touches.length == 3)
                    ctx.restart();
                else if (touch.clientX > (ctx.width / 2)) {
                    if (event.type === 'touchend')
                        self.key.forward = false;
                    else
                        self.key.forward = true;
                }
            });
    }
    else if (ctx.controlType == 4 && bkcore.controllers.OrientationController.isCompatible()) {
        this.orientationController = new bkcore.controllers.OrientationController(
            domElement, true,
            function (state, touch, event) {
                if (event.touches.length >= 4)
                    window.location.reload(false);
                else if (event.touches.length == 3)
                    ctx.restart();
                else if (event.touches.length < 1)
                    self.key.forward = false;
                else
                    self.key.forward = true;
            });
    }
    else if (ctx.controlType == 3 && bkcore.controllers.GamepadController.isCompatible()) {
        this.gamepadController = new bkcore.controllers.GamepadController(
            function (controller) {
                if (controller.select)
                    ctx.restart();
                else
                    self.key.forward = controller.acceleration > 0;
                self.key.ltrigger = controller.ltrigger > 0;
                self.key.rtrigger = controller.rtrigger > 0;
                self.key.left = controller.lstickx < -0.1;
                self.key.right = controller.lstickx > 0.1;
            });
    }
    else if (ctx.controlType == 2) {
        if (Leap == null)
            throw new Error("Unable to reach LeapJS!");

        var leapInfo = this.leapInfo = document.getElementById('leapinfo');
        isServerConnected = false;
        var lb = this.leapBridge = {
            isConnected: true,
            hasHands: false,
            palmNormal: [0, 0, 0]
        };

        function updateInfo() {
            if (!isServerConnected) {
                leapInfo.innerHTML = 'Waiting for the Leap Motion Controller server...'
                leapInfo.style.display = 'block';
            }
            else if (lb.isConnected && lb.hasHands) {
                leapInfo.style.display = 'none';
            }
            else if (!lb.isConnected) {
                leapInfo.innerHTML = 'Please connect your Leap Motion Controller.'
                leapInfo.style.display = 'block';
            }
            else if (!lb.hasHands) {
                leapInfo.innerHTML = 'Put your hand over the Leap Motion Controller to play.'
                leapInfo.style.display = 'block';
            }
        }
        updateInfo();

        var lc = this.leapController = new Leap.Controller({ enableGestures: false });
        lc.on('connect', function () {
            isServerConnected = true;
            updateInfo();
        });
        lc.on('deviceConnected', function () {
            lb.isConnected = true;
            updateInfo();
        });
        lc.on('deviceDisconnected', function () {
            lb.isConnected = false;
            updateInfo();
        });
        lc.on('frame', function (frame) {
            if (!lb.isConnected) return;
            hand = frame.hands[0];
            if (typeof hand === 'undefined') {
                if (lb.hasHands) {
                    lb.hasHands = false;
                    updateInfo();
                }
                lb.palmNormal = [0, 0, 0];
            }
            else {
                if (!lb.hasHands) {
                    lb.hasHands = true;
                    updateInfo();
                }
                lb.palmNormal = hand.palmNormal;
            }
        });
        lc.connect();
    }

    // 시리얼 컨트롤 설정 (controlType == 0)
    if (ctx.controlType == 0) {
        this.setupSerialControls(domElement, ctx);
    }
    else if (!this.touchController && !this.orientationController && !this.gamepadController && ctx.controlType !== 2) {
        // 폴백: 키보드 컨트롤 활성화
        this.enableKeyboardFallback(domElement);
    }

    // 기본 키보드 이벤트 리스너 (항상 활성화)
    function onKeyDown(event) {
        switch (event.keyCode) {
            case 38: /*up*/	self.key.forward = true; break;
            case 40: /*down*/self.key.backward = true; break;
            case 37: /*left*/self.key.left = true; break;
            case 39: /*right*/self.key.right = true; break;
            case 81: /*Q*/self.key.ltrigger = true; break;
            case 65: /*A*/self.key.ltrigger = true; break;
            case 68: /*D*/self.key.rtrigger = true; break;
            case 69: /*E*/self.key.rtrigger = true; break;
        }
    };

    function onKeyUp(event) {
        switch (event.keyCode) {
            case 38: /*up*/	self.key.forward = false; break;
            case 40: /*down*/self.key.backward = false; break;
            case 37: /*left*/self.key.left = false; break;
            case 39: /*right*/self.key.right = false; break;
            case 81: /*Q*/self.key.ltrigger = false; break;
            case 65: /*A*/self.key.ltrigger = false; break;
            case 68: /*D*/self.key.rtrigger = false; break;
            case 69: /*E*/self.key.rtrigger = false; break;
        }
    };

    domElement.addEventListener('keydown', onKeyDown, false);
    domElement.addEventListener('keyup', onKeyUp, false);
};

// ==================== 시리얼 컨트롤 메서드 ====================

bkcore.hexgl.ShipControls.prototype.setupSerialControls = function (domElement, ctx) {
    var self = this;

    if (typeof navigator === 'undefined' || !navigator.serial) {
        console.warn('Web Serial API is not available. Falling back to keyboard controls.');
        this.enableKeyboardFallback(domElement);
        return;
    }

    this.initSerialDebugUI(domElement);
    this.serialControl.stopRequested = false;

    // Check if global serial port is already connected (from landing page)
    if (window.serialPort && window.serialPort.readable) {
        var self = this;

        // Make sure global reader is released before creating new one
        var releaseAndStart = async function () {
            if (window.serialReader) {
                try {
                    var releasePromise = window.serialReader.releaseLock();
                    if (releasePromise && typeof releasePromise.then === 'function') {
                        // Wait for release to complete
                        await releasePromise.catch(function () { });
                    }
                } catch (e) {
                    // Ignore errors, may already be released
                }
                window.serialReader = null;
            }

            // Additional check: wait a bit if stream is still locked
            var attempts = 0;
            while (attempts < 10 && window.serialPort && window.serialPort.readable && window.serialPort.readable.locked) {
                await new Promise(function (resolve) { setTimeout(resolve, 10); });
                attempts++;
            }

            // Now safe to create reader
            self.serialControl.port = window.serialPort;
            self.serialControl.isConnected = true;
            self.serialControl.protocol.reset();
            self.updateSerialDebugStatus('Connected (using global port)', 'connected');
            self.startSerialReadLoop();
        };

        releaseAndStart().catch(function (error) {
            console.error('Failed to release reader and start ShipControls:', error);
            self.updateSerialDebugStatus('Error: ' + error.message, 'idle');
        });
    } else {
        this.attachSerialInteractionHandler(domElement);
    }
};

bkcore.hexgl.ShipControls.prototype.initSerialDebugUI = function (domElement) {
    if (this.serialControl.debugElements)
        return;

    var doc = domElement || document;
    var body = doc.body || doc;
    var panel = doc.createElement('div');
    panel.id = 'hexgl-serial-debug-panel';
    panel.style.position = 'fixed';
    panel.style.bottom = '20px';
    panel.style.right = '20px';
    panel.style.background = 'rgba(0, 0, 0, 0.7)';
    panel.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    panel.style.borderRadius = '8px';
    panel.style.padding = '12px';
    panel.style.zIndex = '99999';
    panel.style.color = '#fff';
    panel.style.fontFamily = 'Arial, sans-serif';
    panel.style.fontSize = '12px';
    panel.style.maxWidth = '260px';
    panel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';

    var title = doc.createElement('div');
    title.textContent = 'AI Camera Control';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';

    var status = doc.createElement('div');
    status.textContent = 'Status: Idle';
    status.style.marginBottom = '8px';
    status.style.color = '#f5f5f5';

    var buttonsWrapper = doc.createElement('div');
    buttonsWrapper.style.display = 'flex';
    buttonsWrapper.style.gap = '6px';
    buttonsWrapper.style.flexWrap = 'wrap';

    var connectBtn = doc.createElement('button');
    connectBtn.textContent = 'Connect Serial';
    connectBtn.style.flex = '1';
    connectBtn.style.padding = '6px 8px';
    connectBtn.style.background = '#4CAF50';
    connectBtn.style.color = '#fff';
    connectBtn.style.border = 'none';
    connectBtn.style.borderRadius = '4px';
    connectBtn.style.cursor = 'pointer';
    connectBtn.style.fontSize = '12px';

    var toggleBtn = doc.createElement('button');
    toggleBtn.textContent = 'Show Debug';
    toggleBtn.style.flex = '1';
    toggleBtn.style.padding = '6px 8px';
    toggleBtn.style.background = '#2196F3';
    toggleBtn.style.color = '#fff';
    toggleBtn.style.border = 'none';
    toggleBtn.style.borderRadius = '4px';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.fontSize = '12px';

    var backBtn = doc.createElement('button');
    backBtn.textContent = 'Back';
    backBtn.style.flex = '1';
    backBtn.style.padding = '6px 8px';
    backBtn.style.background = '#000';
    backBtn.style.color = '#fff';
    backBtn.style.border = 'none';
    backBtn.style.borderRadius = '4px';
    backBtn.style.cursor = 'pointer';
    backBtn.style.fontSize = '12px';

    buttonsWrapper.appendChild(connectBtn);
    buttonsWrapper.appendChild(toggleBtn);
    buttonsWrapper.appendChild(backBtn);

    panel.appendChild(title);
    panel.appendChild(status);
    panel.appendChild(buttonsWrapper);

    var modalOverlay = doc.createElement('div');
    modalOverlay.id = 'hexgl-serial-debug-modal';
    modalOverlay.style.position = 'fixed';
    modalOverlay.style.top = '0';
    modalOverlay.style.left = '0';
    modalOverlay.style.width = '100%';
    modalOverlay.style.height = '100%';
    modalOverlay.style.background = 'rgba(0,0,0,0.6)';
    modalOverlay.style.display = 'none';
    modalOverlay.style.justifyContent = 'center';
    modalOverlay.style.alignItems = 'center';
    modalOverlay.style.zIndex = '100000';

    var modalContent = doc.createElement('div');
    modalContent.style.background = '#111';
    modalContent.style.border = '1px solid #444';
    modalContent.style.borderRadius = '8px';
    modalContent.style.width = '80%';
    modalContent.style.maxWidth = '720px';
    modalContent.style.maxHeight = '80%';
    modalContent.style.overflow = 'hidden';
    modalContent.style.display = 'flex';
    modalContent.style.flexDirection = 'column';

    var modalHeader = doc.createElement('div');
    modalHeader.style.display = 'flex';
    modalHeader.style.justifyContent = 'space-between';
    modalHeader.style.alignItems = 'center';
    modalHeader.style.padding = '12px 16px';
    modalHeader.style.background = '#1f1f1f';
    modalHeader.style.borderBottom = '1px solid #444';

    var modalTitle = doc.createElement('div');
    modalTitle.textContent = 'Serial Debug Monitor';
    modalTitle.style.fontWeight = 'bold';
    modalTitle.style.fontSize = '14px';

    var closeBtn = doc.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.background = '#f44336';
    closeBtn.style.color = '#fff';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.padding = '6px 12px';
    closeBtn.style.cursor = 'pointer';

    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(closeBtn);

    var modalBody = doc.createElement('div');
    modalBody.style.display = 'flex';
    modalBody.style.flex = '1';
    modalBody.style.overflow = 'hidden';

    var rawColumn = doc.createElement('div');
    rawColumn.style.flex = '1';
    rawColumn.style.display = 'flex';
    rawColumn.style.flexDirection = 'column';
    rawColumn.style.borderRight = '1px solid #333';

    var rawHeader = doc.createElement('div');
    rawHeader.textContent = 'Raw Bytes';
    rawHeader.style.padding = '10px 16px';
    rawHeader.style.background = '#1f1f1f';
    rawHeader.style.fontWeight = 'bold';

    var rawList = doc.createElement('div');
    rawList.style.flex = '1';
    rawList.style.padding = '10px 16px';
    rawList.style.overflowY = 'auto';
    rawList.style.fontFamily = 'monospace';
    rawList.style.fontSize = '12px';

    rawColumn.appendChild(rawHeader);
    rawColumn.appendChild(rawList);

    var parsedColumn = doc.createElement('div');
    parsedColumn.style.flex = '1';
    parsedColumn.style.display = 'flex';
    parsedColumn.style.flexDirection = 'column';

    var parsedHeader = doc.createElement('div');
    parsedHeader.textContent = 'Parsed Messages';
    parsedHeader.style.padding = '10px 16px';
    parsedHeader.style.background = '#1f1f1f';
    parsedHeader.style.fontWeight = 'bold';

    var parsedList = doc.createElement('div');
    parsedList.style.flex = '1';
    parsedList.style.padding = '10px 16px';
    parsedList.style.overflowY = 'auto';
    parsedList.style.fontFamily = 'monospace';
    parsedList.style.fontSize = '12px';

    parsedColumn.appendChild(parsedHeader);
    parsedColumn.appendChild(parsedList);

    modalBody.appendChild(rawColumn);
    modalBody.appendChild(parsedColumn);

    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modalOverlay.appendChild(modalContent);

    if (body && body.appendChild) {
        body.appendChild(panel);
        body.appendChild(modalOverlay);
    }

    var self = this;

    connectBtn.addEventListener('click', function () { self.requestSerialConnection(); }, false);
    toggleBtn.addEventListener('click', function () { self.toggleSerialDebugModal(true); }, false);
    backBtn.addEventListener('click', function () { window.location.reload(); }, false);
    closeBtn.addEventListener('click', function () { self.toggleSerialDebugModal(false); }, false);
    modalOverlay.addEventListener('click', function (event) { if (event.target === modalOverlay) self.toggleSerialDebugModal(false); }, false);

    this.serialControl.debugElements = {
        panel: panel,
        status: status,
        connectBtn: connectBtn,
        debugBtn: toggleBtn,
        modal: modalOverlay,
        rawList: rawList,
        parsedList: parsedList
    };

    this.updateSerialDebugStatus('Idle');
};

bkcore.hexgl.ShipControls.prototype.attachSerialInteractionHandler = function (domElement) {
    if (!domElement || this.serialControl.interactionHandler)
        return;

    var self = this;

    var handler = function () {
        self.requestSerialConnection();
    };

    this.serialControl.interactionHandler = handler;
    domElement.addEventListener('click', handler, false);
};

bkcore.hexgl.ShipControls.prototype.toggleSerialDebugModal = function (show) {
    var elements = this.serialControl.debugElements;
    if (!elements || !elements.modal)
        return;

    elements.modal.style.display = show ? 'flex' : 'none';
};

bkcore.hexgl.ShipControls.prototype.updateSerialDebugStatus = function (text, type) {
    var elements = this.serialControl.debugElements;
    if (!elements || !elements.status)
        return;

    elements.status.textContent = 'Status: ' + text;

    if (elements.connectBtn) {
        if (type === 'connected') {
            elements.connectBtn.style.background = '#009688';
            elements.connectBtn.textContent = 'Connected';
            elements.connectBtn.disabled = true;
            elements.connectBtn.style.cursor = 'default';
        }
        else if (type === 'connecting') {
            elements.connectBtn.style.background = '#FFC107';
            elements.connectBtn.textContent = 'Connecting...';
            elements.connectBtn.disabled = true;
            elements.connectBtn.style.cursor = 'progress';
        }
        else {
            elements.connectBtn.style.background = '#4CAF50';
            elements.connectBtn.textContent = 'Connect Serial';
            elements.connectBtn.disabled = false;
            elements.connectBtn.style.cursor = 'pointer';
        }
    }
};

bkcore.hexgl.ShipControls.prototype.logSerialRawByte = function (byte) {
    var debug = this.serialControl.debug;
    if (!debug)
        return;

    var entry = {
        timestamp: new Date().toLocaleTimeString(),
        value: byte
    };

    debug.raw.unshift(entry);
    if (debug.raw.length > 200)
        debug.raw.pop();

    this.renderSerialRawLog();
};

bkcore.hexgl.ShipControls.prototype.renderSerialRawLog = function () {
    var elements = this.serialControl.debugElements;
    if (!elements || !elements.rawList)
        return;

    var html = '';
    var data = this.serialControl.debug.raw;
    var limit = Math.min(data.length, 60);
    for (var i = 0; i < limit; i++) {
        var item = data[i];
        html += '<div style="margin-bottom:4px; color:#fff;">' + item.timestamp + ' → 0x' + ('0' + item.value.toString(16).toUpperCase()).slice(-2) + '</div>';
    }

    elements.rawList.innerHTML = html || '<div style="color:#fff;">No data yet.</div>';
};

bkcore.hexgl.ShipControls.prototype.logSerialParsedMessage = function (payload) {
    var debug = this.serialControl.debug;
    if (!debug)
        return;

    var entry = {
        timestamp: new Date().toLocaleTimeString(),
        payload: payload
    };

    debug.parsed.unshift(entry);
    if (debug.parsed.length > 100)
        debug.parsed.pop();

    this.renderSerialParsedLog();
};

bkcore.hexgl.ShipControls.prototype.renderSerialParsedLog = function () {
    var elements = this.serialControl.debugElements;
    if (!elements || !elements.parsedList)
        return;

    var html = '';
    var data = this.serialControl.debug.parsed;
    var limit = Math.min(data.length, 50);
    for (var i = 0; i < limit; i++) {
        var item = data[i];
        var payload = item.payload || {};
        html += '<div style="margin-bottom:8px; border-bottom:1px solid #333; padding-bottom:6px; color:#fff;">';
        html += '<div style="color:#fff;">' + item.timestamp + '</div>';
        html += '<div style="color:#fff;"><b>Source:</b> ' + (payload.source || 'unknown') + '</div>';
        if (payload.type !== undefined && payload.type !== null) {
            html += '<div style="color:#fff;"><b>Type:</b> ' + payload.type + '</div>';
        }
        html += '<div style="color:#fff;"><b>ID:</b> ' + (payload.id !== undefined ? payload.id : 'n/a');
        if (payload.confidence !== undefined)
            html += ' &nbsp; <b>Score:</b> ' + payload.confidence;
        html += '</div>';
        if (payload.centroid) {
            html += '<div style="color:#fff;"><b>Center:</b> (' + payload.centroid.x + ', ' + payload.centroid.y + ')</div>';
        }
        if (payload.size) {
            html += '<div style="color:#fff;"><b>Size:</b> ' + payload.size.w + ' x ' + payload.size.h + '</div>';
        }
        if (payload.action) {
            html += '<div style="color:#fff;"><b>Action:</b> ' + payload.action + '</div>';
        }
        html += '</div>';
    }

    elements.parsedList.innerHTML = html || '<div style="color:#fff;">No parsed messages yet.</div>';
};

bkcore.hexgl.ShipControls.prototype.requestSerialConnection = function () {
    var self = this;

    if (!navigator.serial)
        return;

    if (this.serialControl.isConnecting || this.serialControl.isConnected)
        return;

    // Check if global serial port is already connected (from landing page)
    if (window.serialPort && window.serialPort.readable) {
        this.serialControl.port = window.serialPort;
        this.serialControl.isConnected = true;
        this.serialControl.protocol.reset();
        if (this.serialControl.interactionHandler && this.dom) {
            this.dom.removeEventListener('click', this.serialControl.interactionHandler, false);
            this.serialControl.interactionHandler = null;
        }
        this.updateSerialDebugStatus('Connected (using global port)', 'connected');
        this.startSerialReadLoop();
        return;
    }

    this.serialControl.isConnecting = true;
    this.serialControl.stopRequested = false;
    this.updateSerialDebugStatus('Requesting access...', 'connecting');

    var connect = async function () {
        try {
            self.serialControl.port = await navigator.serial.requestPort();
            await self.serialControl.port.open({ baudRate: 9600 });
            // Update global serial port if not already set
            if (!window.serialPort || !window.serialPort.readable) {
                window.serialPort = self.serialControl.port;
            }
            self.serialControl.isConnected = true;
            self.serialControl.protocol.reset();
            if (self.serialControl.interactionHandler && self.dom) {
                self.dom.removeEventListener('click', self.serialControl.interactionHandler, false);
                self.serialControl.interactionHandler = null;
            }
            self.updateSerialDebugStatus('Connected', 'connected');
            self.startSerialReadLoop();
        }
        catch (error) {
            // NotFoundError is normal when user cancels port selection
            if (error.name === 'NotFoundError') {
                console.log('Serial port selection cancelled by user');
                self.updateSerialDebugStatus('Connection cancelled', 'idle');
            } else {
                console.error('Serial connection failed:', error);
                self.updateSerialDebugStatus('Error: ' + error.message, 'idle');
            }
        }
        finally {
            self.serialControl.isConnecting = false;
        }
    };

    connect();
};

bkcore.hexgl.ShipControls.prototype.startSerialReadLoop = function () {
    var self = this;

    if (!this.serialControl.port || !this.serialControl.port.readable) {
        console.warn('Serial port not readable. Enabling keyboard fallback.');
        this.enableKeyboardFallback(this.dom);
        return;
    }

    var handleMessage = function (msg) {
        if (!msg || !msg.head)
            return;

        if (msg.head.cmd === HexglMessageCommand.CLASSIFICATION) {
            var type = msg.data && msg.data.length > 0 ? msg.data[0] : null;
            for (var i = 1; i < msg.head.length; i += 2) {
                var id = msg.data[i];
                var confidence = msg.data[i + 1];
                if (typeof id === 'undefined')
                    continue;
                self.logSerialParsedMessage({
                    source: 'classification',
                    type: type,
                    id: id,
                    confidence: confidence,
                    action: self.getSerialActionLabel(id)
                });
                self.handleSerialAction(id, confidence);
            }
        }
        else if (msg.head.cmd === HexglMessageCommand.DETECTION) {
            var dtype = msg.data && msg.data.length > 0 ? msg.data[0] : null;
            for (var j = 1; j < msg.head.length; j += 6) {
                if (j + 5 >= msg.head.length)
                    break;
                var did = msg.data[j];
                var dconfidence = msg.data[j + 5];
                if (typeof did === 'undefined')
                    continue;
                self.logSerialParsedMessage({
                    source: 'detection',
                    type: dtype,
                    id: did,
                    confidence: dconfidence,
                    centroid: { x: msg.data[j + 1], y: msg.data[j + 2] },
                    size: { w: msg.data[j + 3], h: msg.data[j + 4] },
                    action: self.getSerialActionLabel(did)
                });
                self.handleSerialAction(did, dconfidence);
            }
        }
    };

    var readLoop = async function () {
        self.serialControl.reader = self.serialControl.port.readable.getReader();
        try {
            while (true) {
                var result = await self.serialControl.reader.read();
                if (result.done)
                    break;
                if (result.value) {
                    for (var k = 0; k < result.value.length; k++) {
                        self.logSerialRawByte(result.value[k]);
                        var message = self.serialControl.protocol.feedByte(result.value[k]);
                        if (message)
                            handleMessage(message);
                    }
                }
            }
        }
        catch (error) {
            // NetworkError usually means device was disconnected
            if (error.name === 'NetworkError' || error.message && error.message.includes('device has been lost')) {
                console.warn('Serial device disconnected:', error.message || error);
            } else {
                console.error('Serial read error:', error);
            }
        }
        finally {
            if (self.serialControl.reader) {
                try { self.serialControl.reader.releaseLock(); } catch (_e) { }
                self.serialControl.reader = null;
            }
            // Only close port if it's not the global port
            if (self.serialControl.port && self.serialControl.port !== window.serialPort) {
                try { self.serialControl.port.close(); } catch (_e2) { }
                self.serialControl.port = null;
            } else if (self.serialControl.port === window.serialPort) {
                // Clear reference but don't close global port
                self.serialControl.port = null;
            }
            self.serialControl.isConnected = false;
            self.serialControl.protocol.reset();
            self.updateSerialDebugStatus('Disconnected', 'idle');
            if (!self.serialControl.stopRequested && typeof navigator !== 'undefined' && navigator.serial && !self.keyboardFallback) {
                self.attachSerialInteractionHandler(self.dom);
            }
        }
    };

    readLoop();
};

bkcore.hexgl.ShipControls.prototype.handleSerialAction = function (id, confidence) {
    if (id === 0) {
        // 왼쪽만 (가속 없음)
        this.releaseSerialKey('right');
        this.releaseSerialKey('forward');
        this.applyKeyPulse(['left']);
    }
    else if (id === 1) {
        // 직진 가속만
        this.releaseSerialKey('left');
        this.releaseSerialKey('right');
        this.applyKeyPulse(['forward']);
    }
    else if (id === 2) {
        // 오른쪽만 (가속 없음)
        this.releaseSerialKey('left');
        this.releaseSerialKey('forward');
        this.applyKeyPulse(['right']);
    }
    else {
        // 모든 키 해제
        this.releaseSerialKey('left');
        this.releaseSerialKey('right');
        this.releaseSerialKey('forward');
    }
};

bkcore.hexgl.ShipControls.prototype.getSerialActionLabel = function (id) {
    switch (id) {
        case 0:
            return 'left turn';
        case 1:
            return 'forward thrust';
        case 2:
            return 'right turn';
        default:
            return 'stop';
    }
};

bkcore.hexgl.ShipControls.prototype.applyKeyPulse = function (keys, duration) {
    var self = this;
    var pulseDuration = duration == null ? 200 : duration;

    for (var i = 0; i < keys.length; i++) {
        (function (keyName) {
            self.key[keyName] = true;
            if (self.serialControl.timers[keyName]) {
                clearTimeout(self.serialControl.timers[keyName]);
            }
            self.serialControl.timers[keyName] = setTimeout(function () {
                self.key[keyName] = false;
                delete self.serialControl.timers[keyName];
            }, pulseDuration);
        })(keys[i]);
    }
};

bkcore.hexgl.ShipControls.prototype.releaseSerialKey = function (keyName) {
    if (this.serialControl.timers[keyName]) {
        clearTimeout(this.serialControl.timers[keyName]);
        delete this.serialControl.timers[keyName];
    }
    this.key[keyName] = false;
};

bkcore.hexgl.ShipControls.prototype.enableKeyboardFallback = function (domElement) {
    var self = this;

    if (this.serialControl && this.serialControl.interactionHandler && domElement) {
        domElement.removeEventListener('click', this.serialControl.interactionHandler, false);
        this.serialControl.interactionHandler = null;
    }

    this.updateSerialDebugStatus('Keyboard mode', 'idle');

    // 키보드 이벤트는 이미 생성자에서 등록되어 있으므로 별도 작업 불필요
    this.keyboardFallback = true;
};

bkcore.hexgl.ShipControls.prototype.cleanupControls = function () {
    var key;

    if (this.serialControl) {
        for (key in this.serialControl.timers) {
            if (this.serialControl.timers[key]) {
                clearTimeout(this.serialControl.timers[key]);
            }
            this.key[key] = false;
        }
        this.serialControl.timers = {};

        if (this.serialControl.reader) {
            try { this.serialControl.reader.cancel(); } catch (_e) { }
            try { this.serialControl.reader.releaseLock(); } catch (_e2) { }
            this.serialControl.reader = null;
        }
        if (this.serialControl.port) {
            try { this.serialControl.port.close(); } catch (_e3) { }
            this.serialControl.port = null;
        }
        this.serialControl.isConnected = false;
        this.serialControl.protocol.reset();

        if (this.serialControl.interactionHandler && this.dom) {
            this.dom.removeEventListener('click', this.serialControl.interactionHandler, false);
            this.serialControl.interactionHandler = null;
        }

        this.serialControl.stopRequested = true;
    }

    this.updateSerialDebugStatus('Idle', 'idle');
};

// ==================== 기존 메서드들 (변경 없음) ====================

bkcore.hexgl.ShipControls.prototype.control = function (threeMesh) {
    this.mesh = threeMesh;
    this.mesh.martixAutoUpdate = false;
    this.dummy.position = this.mesh.position;
};

bkcore.hexgl.ShipControls.prototype.reset = function (position, rotation) {
    this.resetPos = position;
    this.resetRot = rotation;
    this.movement.set(0, 0, 0);
    this.rotation.copy(rotation);
    this.roll = 0.0;
    this.drift = 0.0;
    this.speed = 0.0;
    this.speedRatio = 0.0;
    this.boost = 0.0;
    this.shield = this.maxShield;
    this.destroyed = false;

    this.dummy.position.copy(position);
    this.quaternion.set(rotation.x, rotation.y, rotation.z, 1).normalize();
    this.dummy.quaternion.set(0, 0, 0, 1);
    this.dummy.quaternion.multiplySelf(this.quaternion);

    this.dummy.matrix.setPosition(this.dummy.position);
    this.dummy.matrix.setRotationFromQuaternion(this.dummy.quaternion);

    this.mesh.matrix.identity();
    this.mesh.applyMatrix(this.dummy.matrix);
}

bkcore.hexgl.ShipControls.prototype.terminate = function () {
    this.cleanupControls();

    this.destroy();

    if (this.leapController != null) {
        this.leapController.disconnect();
        this.leapInfo.style.display = 'none';
    }
}

bkcore.hexgl.ShipControls.prototype.destroy = function () {
    this.cleanupControls();

    bkcore.Audio.play('destroyed');
    bkcore.Audio.stop('bg');
    bkcore.Audio.stop('wind');

    this.active = false;
    this.destroyed = true;
    this.collision.front = false;
    this.collision.left = false;
    this.collision.right = false;
}

bkcore.hexgl.ShipControls.prototype.fall = function () {
    this.active = false;
    this.collision.front = false;
    this.collision.left = false;
    this.collision.right = false;
    this.falling = true;
    _this = this;
    setTimeout(function () {
        _this.destroyed = true;
    }, 1500);
}

bkcore.hexgl.ShipControls.prototype.update = function (dt) {
    if (this.falling) {
        this.mesh.position.addSelf(this.fallVector);
        return;
    }

    this.rotation.y = 0;
    this.movement.set(0, 0, 0);
    this.drift += (0.0 - this.drift) * this.driftLerp;
    this.angular += (0.0 - this.angular) * this.angularLerp * 0.5;

    var rollAmount = 0.0;
    var angularAmount = 0.0;
    var yawLeap = 0.0;

    if (this.leapBridge != null && this.leapBridge.hasHands) {
        rollAmount -= this.leapBridge.palmNormal[0] * 3.5 * this.rollAngle;
        yawLeap = -this.leapBridge.palmNormal[2] * 0.6;
    }

    if (this.active) {

        if (this.touchController != null) {
            angularAmount -= this.touchController.stickVector.x / 100 * this.angularSpeed * dt;
            rollAmount += this.touchController.stickVector.x / 100 * this.rollAngle;
        }
        else if (this.orientationController != null) {
            angularAmount += this.orientationController.beta / 45 * this.angularSpeed * dt;
            rollAmount -= this.orientationController.beta / 45 * this.rollAngle;
        }
        else if (this.gamepadController != null && this.gamepadController.updateAvailable()) {
            angularAmount -= this.gamepadController.lstickx * this.angularSpeed * dt;
            rollAmount += this.gamepadController.lstickx * this.rollAngle;
        }
        else if (this.leapBridge != null && this.leapBridge.hasHands) {
            angularAmount += this.leapBridge.palmNormal[0] * 2 * this.angularSpeed * dt;
            this.speed += Math.max(0.0, (0.5 + this.leapBridge.palmNormal[2])) * 3 * this.thrust * dt;
        }
        else {
            if (this.key.left) {
                angularAmount += this.angularSpeed * dt;
                rollAmount -= this.rollAngle;
            }
            if (this.key.right) {
                angularAmount -= this.angularSpeed * dt;
                rollAmount += this.rollAngle;
            }
        }

        if (this.key.forward)
            this.speed += this.thrust * dt;
        else
            this.speed -= this.airResist * dt;
        if (this.key.ltrigger) {
            if (this.key.left)
                angularAmount += this.airAngularSpeed * dt;
            else
                angularAmount += this.airAngularSpeed * 0.5 * dt;
            this.speed -= this.airBrake * dt;
            this.drift += (this.airDrift - this.drift) * this.driftLerp;
            this.movement.x += this.speed * this.drift * dt;
            if (this.drift > 0.0)
                this.movement.z -= this.speed * this.drift * dt;
            rollAmount -= this.rollAngle * 0.7;
        }
        if (this.key.rtrigger) {
            if (this.key.right)
                angularAmount -= this.airAngularSpeed * dt;
            else
                angularAmount -= this.airAngularSpeed * 0.5 * dt;
            this.speed -= this.airBrake * dt;
            this.drift += (-this.airDrift - this.drift) * this.driftLerp;
            this.movement.x += this.speed * this.drift * dt;
            if (this.drift < 0.0)
                this.movement.z += this.speed * this.drift * dt;
            rollAmount += this.rollAngle * 0.7;
        }
    }

    this.angular += (angularAmount - this.angular) * this.angularLerp;
    this.rotation.y = this.angular;

    this.speed = Math.max(0.0, Math.min(this.speed, this.maxSpeed));
    this.speedRatio = this.speed / this.maxSpeed;
    this.movement.z += this.speed * dt;

    if (this.repulsionForce.isZero()) {
        this.repulsionForce.set(0, 0, 0);
    }
    else {
        if (this.repulsionForce.z != 0.0) this.movement.z = 0;
        this.movement.addSelf(this.repulsionForce);
        this.repulsionForce.lerpSelf(this.zero, dt > 1.5 ? this.repulsionLerp * 2 : this.repulsionLerp);
    }

    this.collisionPreviousPosition.copy(this.dummy.position);

    this.boosterCheck(dt);

    this.dummy.translateX(this.movement.x);
    this.dummy.translateZ(this.movement.z);

    this.heightCheck(dt);
    this.dummy.translateY(this.movement.y);

    this.currentVelocity.copy(this.dummy.position).subSelf(this.collisionPreviousPosition);

    this.collisionCheck(dt);

    this.quaternion.set(this.rotation.x, this.rotation.y, this.rotation.z, 1).normalize();
    this.dummy.quaternion.multiplySelf(this.quaternion);

    this.dummy.matrix.setPosition(this.dummy.position);
    this.dummy.matrix.setRotationFromQuaternion(this.dummy.quaternion);

    if (this.shield <= 0.0) {
        this.shield = 0.0;
        this.destroy();
    }

    if (this.mesh != null) {
        this.mesh.matrix.identity();

        var gradientDelta = (this.gradientTarget - (yawLeap + this.gradient)) * this.gradientLerp;
        if (Math.abs(gradientDelta) > this.epsilon) this.gradient += gradientDelta;
        if (Math.abs(this.gradient) > this.epsilon) {
            this.gradientAxis.set(1, 0, 0);
            this.mesh.matrix.rotateByAxis(this.gradientAxis, this.gradient);
        }

        var tiltDelta = (this.tiltTarget - this.tilt) * this.tiltLerp;
        if (Math.abs(tiltDelta) > this.epsilon) this.tilt += tiltDelta;
        if (Math.abs(this.tilt) > this.epsilon) {
            this.tiltAxis.set(0, 0, 1);
            this.mesh.matrix.rotateByAxis(this.tiltAxis, this.tilt);
        }

        var rollDelta = (rollAmount - this.roll) * this.rollLerp;
        if (Math.abs(rollDelta) > this.epsilon) this.roll += rollDelta;
        if (Math.abs(this.roll) > this.epsilon) {
            this.rollAxis.copy(this.rollDirection);
            this.mesh.matrix.rotateByAxis(this.rollAxis, this.roll);
        }

        this.mesh.applyMatrix(this.dummy.matrix);
        this.mesh.updateMatrixWorld(true);
    }

    bkcore.Audio.setListenerPos(this.movement);
    bkcore.Audio.setListenerVelocity(this.currentVelocity);
};

bkcore.hexgl.ShipControls.prototype.teleport = function (pos, quat) {
    this.quaternion.copy(quat);
    this.dummy.quaternion.copy(this.quaternion);

    this.dummy.position.copy(pos);
    this.dummy.matrix.setPosition(this.dummy.position);

    this.dummy.matrix.setRotationFromQuaternion(this.dummy.quaternion);

    if (this.mesh != null) {
        this.mesh.matrix.identity();

        var gradientDelta = (this.gradientTarget - this.gradient) * this.gradientLerp;
        if (Math.abs(gradientDelta) > this.epsilon) this.gradient += gradientDelta;
        if (Math.abs(this.gradient) > this.epsilon) {
            this.gradientAxis.set(1, 0, 0);
            this.mesh.matrix.rotateByAxis(this.gradientAxis, this.gradient);
        }

        var tiltDelta = (this.tiltTarget - this.tilt) * this.tiltLerp;
        if (Math.abs(tiltDelta) > this.epsilon) this.tilt += tiltDelta;
        if (Math.abs(this.tilt) > this.epsilon) {
            this.tiltAxis.set(0, 0, 1);
            this.mesh.matrix.rotateByAxis(this.tiltAxis, this.tilt);
        }

        this.mesh.applyMatrix(this.dummy.matrix);
        this.mesh.updateMatrixWorld(true);
    }
}

bkcore.hexgl.ShipControls.prototype.boosterCheck = function (dt) {
    if (!this.collisionMap || !this.collisionMap.loaded)
        return false;

    this.boost -= this.boosterDecay * dt;
    if (this.boost < 0) {
        this.boost = 0.0;
        bkcore.Audio.stop('boost');
    }

    var x = Math.round(this.collisionMap.pixels.width / 2 + this.dummy.position.x * this.collisionPixelRatio);
    var z = Math.round(this.collisionMap.pixels.height / 2 + this.dummy.position.z * this.collisionPixelRatio);
    var pos = new THREE.Vector3(x, 0, z);

    var color = this.collisionMap.getPixel(x, z);

    if (color.r == 255 && color.g < 127 && color.b < 127) {
        bkcore.Audio.play('boost');
        this.boost = this.boosterSpeed;
    }

    this.movement.z += this.boost * dt;
}

bkcore.hexgl.ShipControls.prototype.collisionCheck = function (dt) {
    if (!this.collisionDetection || !this.collisionMap || !this.collisionMap.loaded)
        return false;

    if (this.shieldDelay > 0)
        this.shieldDelay -= dt;

    this.collision.left = false;
    this.collision.right = false;
    this.collision.front = false;

    var x = Math.round(this.collisionMap.pixels.width / 2 + this.dummy.position.x * this.collisionPixelRatio);
    var z = Math.round(this.collisionMap.pixels.height / 2 + this.dummy.position.z * this.collisionPixelRatio);
    var pos = new THREE.Vector3(x, 0, z);

    var collision = this.collisionMap.getPixelBilinear(x, z);

    if (collision.r < 255) {
        bkcore.Audio.play('crash');

        this.shield = this.maxShield;

        this.repulsionVLeft.set(1, 0, 0);
        this.repulsionVRight.set(-1, 0, 0);
        this.dummy.matrix.rotateAxis(this.repulsionVLeft);
        this.dummy.matrix.rotateAxis(this.repulsionVRight);
        this.repulsionVLeft.multiplyScalar(this.repulsionVScale);
        this.repulsionVRight.multiplyScalar(this.repulsionVScale);

        var lPos = this.repulsionVLeft.addSelf(pos);
        var rPos = this.repulsionVRight.addSelf(pos);
        var lCol = this.collisionMap.getPixel(Math.round(lPos.x), Math.round(lPos.z)).r;
        var rCol = this.collisionMap.getPixel(Math.round(rPos.x), Math.round(rPos.z)).r;

        this.repulsionAmount = Math.max(0.8,
            Math.min(this.repulsionCap,
                this.speed * this.repulsionRatio
            )
        );

        if (rCol > lCol) {
            this.repulsionForce.x += -this.repulsionAmount;
            this.collision.left = true;
        }
        else if (rCol < lCol) {
            this.repulsionForce.x += this.repulsionAmount;
            this.collision.right = true;
        }
        else {
            this.repulsionForce.z += -this.repulsionAmount * 4;
            this.collision.front = true;
            this.speed = 0;
        }

        if (rCol < 128 && lCol < 128) {
            var fCol = this.collisionMap.getPixel(Math.round(pos.x + 2), Math.round(pos.z + 2)).r;
            if (fCol < 128) {
                console.log('GAMEOVER');
                this.fall();
            }
        }

        this.speed *= this.collisionSpeedDecrease;
        this.speed *= (1 - this.collisionSpeedDecreaseCoef * (1 - collision.r / 255));
        this.boost = 0;

        return true;
    }
    else {
        return false;
    }
}

bkcore.hexgl.ShipControls.prototype.heightCheck = function (dt) {
    if (!this.heightMap || !this.heightMap.loaded)
        return false;

    var x = this.heightMap.pixels.width / 2 + this.dummy.position.x * this.heightPixelRatio;
    var z = this.heightMap.pixels.height / 2 + this.dummy.position.z * this.heightPixelRatio;
    var height = this.heightMap.getPixelFBilinear(x, z) / this.heightScale + this.heightBias;

    var color = this.heightMap.getPixel(x, z);

    if (height < 16777) {
        var delta = (height - this.dummy.position.y);

        if (delta > 0) {
            this.movement.y += delta;
        }
        else {
            this.movement.y += delta * this.heightLerp;
        }
    }

    this.gradientVector.set(0, 0, 5);
    this.dummy.matrix.rotateAxis(this.gradientVector);
    this.gradientVector.addSelf(this.dummy.position);

    x = this.heightMap.pixels.width / 2 + this.gradientVector.x * this.heightPixelRatio;
    z = this.heightMap.pixels.height / 2 + this.gradientVector.z * this.heightPixelRatio;

    var nheight = this.heightMap.getPixelFBilinear(x, z) / this.heightScale + this.heightBias;

    if (nheight < 16777)
        this.gradientTarget = -Math.atan2(nheight - height, 5.0) * this.gradientScale;

    this.tiltVector.set(5, 0, 0);
    this.dummy.matrix.rotateAxis(this.tiltVector);
    this.tiltVector.addSelf(this.dummy.position);

    x = this.heightMap.pixels.width / 2 + this.tiltVector.x * this.heightPixelRatio;
    z = this.heightMap.pixels.height / 2 + this.tiltVector.z * this.heightPixelRatio;

    nheight = this.heightMap.getPixelFBilinear(x, z) / this.heightScale + this.heightBias;

    if (nheight >= 16777) {
        this.tiltVector.subSelf(this.dummy.position).multiplyScalar(-1).addSelf(this.dummy.position);

        x = this.heightMap.pixels.width / 2 + this.tiltVector.x * this.heightPixelRatio;
        z = this.heightMap.pixels.height / 2 + this.tiltVector.z * this.heightPixelRatio;

        nheight = this.heightMap.getPixelFBilinear(x, z) / this.heightScale + this.heightBias;
    }

    if (nheight < 16777)
        this.tiltTarget = Math.atan2(nheight - height, 5.0) * this.tiltScale;
};

bkcore.hexgl.ShipControls.prototype.getRealSpeed = function (scale) {
    return Math.round(
        (this.speed + this.boost)
        * (scale == undefined ? 1 : scale)
    );
};

bkcore.hexgl.ShipControls.prototype.getRealSpeedRatio = function () {
    return Math.min(
        this.maxSpeed,
        this.speed + this.boost
    ) / this.maxSpeed;
};

bkcore.hexgl.ShipControls.prototype.getSpeedRatio = function () {
    return (this.speed + this.boost) / this.maxSpeed;
};

bkcore.hexgl.ShipControls.prototype.getBoostRatio = function () {
    return this.boost / this.boosterSpeed;
};

bkcore.hexgl.ShipControls.prototype.getShieldRatio = function () {
    return this.shield / this.maxShield;
};

bkcore.hexgl.ShipControls.prototype.getShield = function (scale) {
    return Math.round(
        this.shield
        * (scale == undefined ? 1 : scale)
    );
};

bkcore.hexgl.ShipControls.prototype.getPosition = function () {
    return this.dummy.position;
}

bkcore.hexgl.ShipControls.prototype.getQuaternion = function () {
    return this.dummy.quaternion;
}
