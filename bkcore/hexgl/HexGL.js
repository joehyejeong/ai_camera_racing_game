/*
* HexGL
* @author Thibaut 'BKcore' Despoulain <http://bkcore.com>
* @license This work is licensed under the Creative Commons Attribution-NonCommercial 3.0 Unported License.
*          To view a copy of this license, visit http://creativecommons.org/licenses/by-nc/3.0/.
*/

'use strict';
'v1.0.1';

var bkcore = bkcore || {};
bkcore.hexgl = bkcore.hexgl || {};

bkcore.hexgl.HexGL = function (opts) {
	var self = this;

	this.document = opts.document || document;

	this.a = window.location.href;

	this.active = true;
	this.displayHUD = opts.hud == undefined ? true : opts.hud;
	this.width = opts.width == undefined ? window.innerWidth : opts.width;
	this.height = opts.height == undefined ? window.innerHeight : opts.height;

	this.difficulty = opts.difficulty == undefined ? 0 : opts.difficulty;
	this.player = opts.player == undefined ? "Anonym" : opts.player;

	this.track = bkcore.hexgl.tracks[opts.track == undefined ? 'Cityscape' : opts.track];

	this.mode = opts.mode == undefined ? 'timeattack' : opts.mode;

	this.controlType = opts.controlType == undefined ? 1 : opts.controlType;

	// 0 == low, 1 == mid, 2 == high, 3 == very high
	// the old platform+quality combinations map to these new quality values
	// as follows:
	// mobile + low quality => 0 (LOW)
	// mobile + mid quality OR desktop + low quality => 1 (MID)
	// mobile + high quality => 2 (HIGH)
	// desktop + mid or high quality => 3 (VERY HIGH)
	this.quality = opts.quality == undefined ? 3 : opts.quality;

	if (this.quality === 0) {
		this.width /= 2;
		this.height /= 2;
	}

	this.settings = null;
	this.renderer = null;
	this.manager = null;
	this.lib = null;
	this.materials = {};
	this.components = {};
	this.extras = {
		vignetteColor: new THREE.Color(0x458ab1),
		bloom: null,
		fxaa: null
	};

	this.containers = {};
	this.containers.main = opts.container == undefined ? document.body : opts.container;
	this.containers.overlay = opts.overlay == undefined ? document.body : opts.overlay;

	this.gameover = opts.gameover == undefined ? null : opts.gameover;

	this.godmode = opts.godmode == undefined ? false : opts.godmode;

	this.hud = null;

	this.gameplay = null;

	this.minimap = null;

	this.bestScoreEl = this.document.getElementById('best-score');
	this.bestScoreKey = this.buildBestScoreKey();
	this.bestTimes = this.loadBestTimesFromStorage();

	this.composers = {
		game: null
	};

	this.initRenderer();

	function onKeyPress(event) {
		if (event.keyCode == 27/*escape*/) {
			self.reset();
		}
	}

	this.document.addEventListener('keydown', onKeyPress, false);
}

bkcore.hexgl.HexGL.prototype.start = function () {

	this.manager.setCurrent("game");

	var self = this;

	function raf() {
		if (self && self.active) requestAnimationFrame(raf);
		self.update();
	}

	//if(this.a[15] == "o")
	raf();

	this.initGameplay();
}

bkcore.hexgl.HexGL.prototype.reset = function () {
	this.manager.get('game').objects.lowFPS = 0;
	this.gameplay.start();

	bkcore.Audio.stop('bg');
	bkcore.Audio.stop('wind');
	bkcore.Audio.volume('wind', 0.35);
	bkcore.Audio.play('bg');
	bkcore.Audio.play('wind');
}

bkcore.hexgl.HexGL.prototype.restart = function () {
	try { this.document.getElementById('finish').style.display = 'none'; }
	catch (e) { };
	this.reset();
}

bkcore.hexgl.HexGL.prototype.update = function () {
	if (!this.active) return;

	if (this.gameplay != null)
		this.gameplay.update();

	this.manager.renderCurrent();

	this.updateMiniMap();
}

bkcore.hexgl.HexGL.prototype.init = function () {
	this.initHUD();

	this.track.buildMaterials(this.quality);

	this.track.buildScenes(this, this.quality);

	this.initGameComposer();

	this.initMiniMap();

	this.updateBestScoreDisplay();
}

bkcore.hexgl.HexGL.prototype.load = function (opts) {
	this.track.load(opts, this.quality);
}

bkcore.hexgl.HexGL.prototype.initGameplay = function () {
	var self = this;

	this.gameplay = new bkcore.hexgl.Gameplay({
		mode: this.mode,
		hud: this.hud,
		shipControls: this.components.shipControls,
		cameraControls: this.components.cameraChase,
		analyser: this.track.analyser,
		pixelRatio: this.track.pixelRatio,
		track: this.track,
		timeLimit: 2 * 60 * 1000,
		onFinish: function () {
			self.components.shipControls.terminate();
			self.displayScore(this.finishTime, this.lapTimes);
		}
	});

	this.gameplay.start();

	bkcore.Audio.play('bg');
	bkcore.Audio.play('wind');
	bkcore.Audio.volume('wind', 0.35);
}

bkcore.hexgl.HexGL.prototype.displayScore = function (f, l) {
	this.active = false;

	var tf = bkcore.Timer.msToTimeString(f);
	var tl = [
		bkcore.Timer.msToTimeString(l[0]),
		bkcore.Timer.msToTimeString(l[1]),
		bkcore.Timer.msToTimeString(l[2])
	];

	var isFinish = this.gameplay != null && this.gameplay.result == this.gameplay.results.FINISH;
	var newFirstRecord = false;
	if (isFinish && typeof f === "number" && !isNaN(f)) {
		newFirstRecord = this.saveBestTime(f);
	} else {
		this.updateBestScoreDisplay();
	}

	if (this.gameover !== null) {
		this.gameover.style.display = "block";
		this.gameover.children[0].innerHTML = tf.m + "'" + tf.s + "''" + tf.ms;

		var finalList = this.document.getElementById("best-score-final");
		if (finalList) {
			finalList.textContent = this.buildBestTimesLines(true).join("\n");
		}

		var finalMessage = this.document.getElementById("best-score-message");
		if (finalMessage) {
			if (isFinish && newFirstRecord) {
				finalMessage.innerHTML = "축하합니다! 기록을 갱신하였습니다!";
				finalMessage.style.display = "block";
			} else {
				finalMessage.innerHTML = "";
				finalMessage.style.display = "none";
			}
		}

		if (isFinish && newFirstRecord) {
			try {
				bkcore.Audio.play('boost');
			}
			catch (e) {
				console.warn('Unable to play boost sound for new record.', e);
			}
		}

		this.containers.main.parentElement.style.display = "none";
		return;
	}

	var t = this.track;
	var dc = this.document.getElementById("finish");
	var ds = this.document.getElementById("finish-state");
	var dh = this.document.getElementById("finish-hallmsg");
	var dr = this.document.getElementById("finish-msg");
	var dt = this.document.getElementById("finish-result");
	var dl1 = this.document.getElementById("finish-lap1");
	var dl2 = this.document.getElementById("finish-lap2");
	var dl3 = this.document.getElementById("finish-lap3");
	var dd = this.document.getElementById("finish-diff")
	var st = this.document.getElementById("finish-twitter");
	var sf = this.document.getElementById("finish-fb");
	var sl = this.document.getElementById("lowfps-msg");
	var d = this.difficulty == 0 ? 'casual' : 'hard';
	var ts = this.hud.timeSeparators;

	if (isFinish) {
		ds != undefined && (ds.innerHTML = "Finished!");
		// local record
		if (typeof (Storage) !== "undefined") {
			if (localStorage['score-' + t + '-' + d] == undefined || localStorage['score-' + t + '-' + d] > f) {
				dr != undefined && (dr.innerHTML = "New local record!");
				localStorage['score-' + t + '-' + d] = f;

				// Export race data
				localStorage['race-' + t + '-replay'] = JSON.stringify(this.gameplay.raceData.export());
			}
			else {
				dr != undefined && (dr.innerHTML = "Well done!");
			}
		}

		// ladder record
		var p = bkcore.hexgl.Ladder.global[t][d][bkcore.hexgl.Ladder.global[t][d].length - 2];
		if (p != undefined && p['score'] > f) {
			dh != undefined && (dh.innerHTML = "You made it to the HOF!");
		}
		else {
			dh != undefined && (dh.innerHTML = "Hall Of Fame");
		}

		dt != undefined && (dt.innerHTML = tf.m + ts[1] + tf.s + ts[2] + tf.ms);
		dl1 != undefined && (dl1.innerHTML = tl[0]["m"] != undefined ? tl[0].m + ts[1] + tl[0].s + ts[2] + tl[0].ms : "-");
		dl2 != undefined && (dl2.innerHTML = tl[1]["m"] != undefined ? tl[1].m + ts[1] + tl[1].s + ts[2] + tl[1].ms : "-");
		dl3 != undefined && (dl3.innerHTML = tl[2]["m"] != undefined ? tl[2].m + ts[1] + tl[2].s + ts[2] + tl[2].ms : "-");

		// Ladder save
		// Undisclosed
	}
	else {
		ds != undefined && (ds.innerHTML = "Destroyed!");
		dr != undefined && (dr.innerHTML = "Maybe next time!");
		dh != undefined && (dh.innerHTML = "Hall Of Fame");
		dt != undefined && (dt.innerHTML = "None");
		dl1 != undefined && (dl1.innerHTML = "None");
		dl2 != undefined && (dl2.innerHTML = "None");
		dl3 != undefined && (dl3.innerHTML = "None");
	}

	dd != undefined && (dd.innerHTML = d);
	st != undefined && (st.href = 'http://twitter.com/share?text=' + encodeURIComponent('I just scored ' + dt.innerHTML + ' in ' + 'Cityscape (' + d + ') on #HexGL! Come try it and beat my record on '));
	sf != undefined && (sf.href = 'http://www.facebook.com/sharer.php?s=100'
		+ '&p[title]=' + encodeURIComponent('I just scored ' + dt.innerHTML + ' in ' + 'Cityscape (' + d + ') on HexGL!')
		+ '&p[summary]=' + encodeURIComponent('HexGL is a futuristic racing game built by Thibaut Despoulain (BKcore) using HTML5, Javascript and WebGL. Come challenge your friends on this fast-paced 3D game!')
		+ '&p[url]=' + encodeURIComponent('http://hexgl.bkcore.com')
		+ '&p[images][0]=' + encodeURIComponent('http://hexgl.bkcore.com/image.png'));

	bkcore.hexgl.Ladder.displayLadder('finish-ladder', t, d, 8);

	if (this.manager.get('game').objects.lowFPS >= 999)
		sl != undefined && (sl.innerHTML = 'Note: Your framerate was pretty low, you should try a lesser graphic setting!');
	else
		sl != undefined && (sl.innerHTML = '');

	dc.style.display = 'block';

	this.updateBestScoreDisplay();
}

bkcore.hexgl.HexGL.prototype.initRenderer = function () {
	var renderer = new THREE.WebGLRenderer({
		antialias: false,
		clearColor: 0x000000
	});

	// desktop + quality mid or high
	if (this.quality > 2) {
		renderer.physicallyBasedShading = true;
		renderer.gammaInput = true;
		renderer.gammaOutput = true;
		renderer.shadowMapEnabled = true;
		renderer.shadowMapSoft = true;
	}

	renderer.autoClear = false;
	renderer.sortObjects = false;
	renderer.setSize(this.width, this.height);
	renderer.domElement.style.position = "relative";

	this.containers.main.appendChild(renderer.domElement);
	this.canvas = renderer.domElement;
	this.renderer = renderer;
	this.manager = new bkcore.threejs.RenderManager(renderer);
}

bkcore.hexgl.HexGL.prototype.initHUD = function () {
	if (!this.displayHUD) return;
	this.hud = new bkcore.hexgl.HUD({
		width: this.width,
		height: this.height,
		font: "BebasNeueRegular",
		bg: this.track.lib.get("images", "hud.bg"),
		speed: this.track.lib.get("images", "hud.speed"),
		shield: this.track.lib.get("images", "hud.shield")
	});
	this.containers.overlay.appendChild(this.hud.canvas);
}

bkcore.hexgl.HexGL.prototype.initMiniMap = function () {
	var canvas = this.document.getElementById("mini-map-canvas");
	var container = this.document.getElementById("mini-map");

	if (!canvas || !container) {
		this.minimap = null;
		return;
	}

	var analyser = this.track != null ? this.track.analyser : null;
	if (!analyser || !analyser.pixels) {
		container.style.display = "none";
		this.minimap = null;
		return;
	}

	var mapWidth = analyser.pixels.width;
	var mapHeight = analyser.pixels.height;
	if (!mapWidth || !mapHeight) {
		container.style.display = "none";
		this.minimap = null;
		return;
	}

	var targetSize = 180;
	var aspect = mapHeight / mapWidth;
	var canvasWidth = targetSize;
	var canvasHeight = Math.round(targetSize * aspect);
	if (!isFinite(canvasHeight) || canvasHeight <= 0)
		canvasHeight = targetSize;

	canvas.width = canvasWidth;
	canvas.height = canvasHeight;
	container.style.display = "block";
	container.style.width = canvasWidth + "px";
	container.style.height = canvasHeight + "px";

	var rawCanvas = this.document.createElement("canvas");
	rawCanvas.width = mapWidth;
	rawCanvas.height = mapHeight;
	var rawCtx = rawCanvas.getContext("2d");
	rawCtx.putImageData(analyser.pixels, 0, 0);

	var baseCanvas = this.document.createElement("canvas");
	baseCanvas.width = canvasWidth;
	baseCanvas.height = canvasHeight;
	var baseCtx = baseCanvas.getContext("2d");
	baseCtx.drawImage(rawCanvas, 0, 0, canvasWidth, canvasHeight);
	baseCtx.fillStyle = "rgba(0, 0, 0, 0.35)";
	baseCtx.fillRect(0, 0, canvasWidth, canvasHeight);
	baseCtx.globalCompositeOperation = "lighter";
	baseCtx.drawImage(rawCanvas, 0, 0, canvasWidth, canvasHeight);
	baseCtx.globalCompositeOperation = "source-over";

	var finishMapX = null;
	var finishMapY = null;

	// Find finish position at last checkpoint (checkpoint 1)
	if (this.track && this.track.checkpoints && analyser && analyser.loaded) {
		var lastCheckpoint = this.track.checkpoints.last;

		// Search for yellow checkpoint (last checkpoint, B=last)
		for (var z = 0; z < mapHeight && finishMapX == null; z++) {
			for (var x = 0; x < mapWidth && finishMapX == null; x++) {
				var color = analyser.getPixel(x, z);
				// Check if it's yellow checkpoint with B matching last checkpoint
				if (color.r == 255 && color.g == 255 && color.b == lastCheckpoint) {
					// Find nearby white track
					var foundWhite = false;
					var finishX = x;
					var finishZ = z;

					for (var radius = 1; radius <= 30 && !foundWhite; radius++) {
						for (var offsetZ = -radius; offsetZ <= radius && !foundWhite; offsetZ++) {
							for (var offsetX = -radius; offsetX <= radius && !foundWhite; offsetX++) {
								if (radius > 1 && (Math.abs(offsetX) != radius && Math.abs(offsetZ) != radius)) continue;

								var checkX = x + offsetX;
								var checkZ = z + offsetZ;
								if (checkX >= 0 && checkX < mapWidth && checkZ >= 0 && checkZ < mapHeight) {
									var trackColor = analyser.getPixel(checkX, checkZ);
									if (trackColor.r >= 250 && trackColor.g >= 250 && trackColor.b >= 250) {
										finishX = checkX;
										finishZ = checkZ;
										foundWhite = true;
									}
								}
							}
						}
					}

					if (foundWhite) {
						finishMapX = finishX;
						finishMapY = finishZ;
					}
				}
			}
		}
	}

	// Fallback to spawn position if finish checkpoint not found
	if (finishMapX == null && this.track && this.track.spawn) {
		finishMapX = mapWidth / 2 + this.track.spawn.x * this.track.pixelRatio;
		finishMapY = mapHeight / 2 + this.track.spawn.z * this.track.pixelRatio;
	}

	this.minimap = {
		canvas: canvas,
		ctx: canvas.getContext("2d"),
		container: container,
		base: baseCanvas,
		mapWidth: mapWidth,
		mapHeight: mapHeight,
		scaleX: canvasWidth / mapWidth,
		scaleY: canvasHeight / mapHeight,
		markerSize: Math.max(5, Math.round(canvasWidth * 0.05)),
		pixelRatio: this.track.pixelRatio,
		finishPosition: finishMapX != null && finishMapY != null ? { x: finishMapX, y: finishMapY } : null
	};

	this.updateMiniMap(true);
}

bkcore.hexgl.HexGL.prototype.updateMiniMap = function (force) {
	if (!this.minimap || !this.minimap.ctx || !this.minimap.base)
		return;

	var shipControls = this.components ? this.components.shipControls : null;
	if (!shipControls || !shipControls.dummy) {
		if (force)
			this.minimap.ctx.drawImage(this.minimap.base, 0, 0);
		return;
	}

	var dummy = shipControls.dummy;
	var mm = this.minimap;
	var ctx = mm.ctx;

	ctx.clearRect(0, 0, mm.canvas.width, mm.canvas.height);
	ctx.drawImage(mm.base, 0, 0);

	var mapX = mm.mapWidth / 2 + dummy.position.x * mm.pixelRatio;
	var mapY = mm.mapHeight / 2 + dummy.position.z * mm.pixelRatio;

	var px = mapX * mm.scaleX;
	var py = mapY * mm.scaleY;

	px = Math.max(0, Math.min(px, mm.canvas.width));
	py = Math.max(0, Math.min(py, mm.canvas.height));

	var markerRadius = mm.markerSize;
	ctx.save();
	ctx.translate(px, py);

	ctx.beginPath();
	ctx.arc(0, 0, markerRadius, 0, Math.PI * 2, false);
	ctx.fillStyle = "rgba(255, 90, 90, 0.95)";
	ctx.fill();
	ctx.lineWidth = Math.max(1, Math.round(markerRadius * 0.25));
	ctx.strokeStyle = "rgba(255, 255, 255, 0.98)";
	ctx.stroke();
	ctx.restore();

	if (mm.finishPosition) {
		var finishPx = mm.finishPosition.x * mm.scaleX;
		var finishPy = mm.finishPosition.y * mm.scaleY;

		ctx.save();
		ctx.translate(finishPx, finishPy);
		ctx.beginPath();
		ctx.arc(0, 0, Math.max(4, markerRadius * 0.7), 0, Math.PI * 2, false);
		ctx.fillStyle = "rgba(90, 170, 255, 0.95)";
		ctx.fill();
		ctx.lineWidth = Math.max(1, Math.round(markerRadius * 0.2));
		ctx.strokeStyle = "rgba(240, 240, 255, 0.9)";
		ctx.stroke();
		ctx.restore();
	}
}

bkcore.hexgl.HexGL.prototype.initGameComposer = function () {
	var renderTargetParameters = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBFormat, stencilBuffer: false };
	var renderTarget = new THREE.WebGLRenderTarget(this.width, this.height, renderTargetParameters);

	// GAME COMPOSER
	var renderSky = new THREE.RenderPass(this.manager.get("sky").scene, this.manager.get("sky").camera);

	var renderModel = new THREE.RenderPass(this.manager.get("game").scene, this.manager.get("game").camera);
	renderModel.clear = false;

	this.composers.game = new THREE.EffectComposer(this.renderer, renderTarget);

	var effectScreen = new THREE.ShaderPass(THREE.ShaderExtras["screen"]);
	effectScreen.renderToScreen = true;
	var effectVignette = new THREE.ShaderPass(THREE.ShaderExtras["vignette"]);

	var effectHex = new THREE.ShaderPass(bkcore.threejs.Shaders["hexvignette"]);
	effectHex.uniforms['size'].value = 512.0 * (this.width / 1633);
	effectHex.uniforms['rx'].value = this.width;
	effectHex.uniforms['ry'].value = this.height;
	effectHex.uniforms['tHex'].texture = this.track.lib.get("textures", "hex");
	effectHex.uniforms['color'].value = this.extras.vignetteColor;

	effectHex.renderToScreen = true;

	this.composers.game.addPass(renderSky);
	this.composers.game.addPass(renderModel);

	// if(this.quality > 0 && !this.mobile)
	// {
	// 	var effectFXAA = new THREE.ShaderPass( THREE.ShaderExtras[ "fxaa" ] );
	// 	effectFXAA.uniforms[ 'resolution' ].value.set( 1 / this.width, 1 / this.height );

	// 	this.composers.game.addPass( effectFXAA );

	// 	this.extras.fxaa = effectFXAA;

	// }

	// desktop + quality mid or high
	if (this.quality > 2) {
		var effectBloom = new THREE.BloomPass(0.8, 25, 4, 256);

		this.composers.game.addPass(effectBloom);

		this.extras.bloom = effectBloom;
	}

	// desktop + quality low, mid or high
	// OR
	// mobile + quality mid or high
	if (this.quality > 0)
		this.composers.game.addPass(effectHex);
	else
		this.composers.game.addPass(effectScreen);
}

bkcore.hexgl.HexGL.prototype.createMesh = function (parent, geometry, x, y, z, mat) {
	geometry.computeTangents();

	var mesh = new THREE.Mesh(geometry, mat);
	mesh.position.set(x, y, z);
	parent.add(mesh);

	// desktop + quality mid or high
	if (this.quality > 2) {
		mesh.castShadow = true;
		mesh.receiveShadow = true;
	}

	return mesh;
}

bkcore.hexgl.HexGL.prototype.tweakShipControls = function () {
	var c = this.components.shipControls;
	if (this.difficulty == 1) {
		c.airResist = 0.035;
		c.airDrift = 0.07;
		c.thrust = 0.035;
		c.airBrake = 0.04;
		c.maxSpeed = 9.6;
		c.boosterSpeed = c.maxSpeed * 0.35;
		c.boosterDecay = 0.007;
		c.angularSpeed = 0.0140;
		c.airAngularSpeed = 0.0165;
		c.rollAngle = 0.6;
		c.shieldDamage = 0.03;
		c.collisionSpeedDecrease = 0.8;
		c.collisionSpeedDecreaseCoef = 0.5;
		c.rollLerp = 0.1;
		c.driftLerp = 0.4;
		c.angularLerp = 0.4;
	}
	else if (this.difficulty == 0) {
		c.airResist = 0.02;
		c.airDrift = 0.06;
		c.thrust = 0.02;
		c.airBrake = 0.025;
		c.maxSpeed = 7.0;
		c.boosterSpeed = c.maxSpeed * 0.5;
		c.boosterDecay = 0.007;
		c.angularSpeed = 0.0125;
		c.airAngularSpeed = 0.0135;
		c.rollAngle = 0.6;
		c.shieldDamage = 0.06;
		c.collisionSpeedDecrease = 0.8;
		c.collisionSpeedDecreaseCoef = 0.5;
		c.rollLerp = 0.07;
		c.driftLerp = 0.3;
		c.angularLerp = 0.4;
	}

	if (this.godmode)
		c.shieldDamage = 0.0;
}

bkcore.hexgl.HexGL.prototype.updateBestScoreDisplay = function () {
	if (!this.bestScoreEl)
		return;

	var lines = this.buildBestTimesLines(true);

	this.bestScoreEl.textContent = lines.join("\n");
	this.bestScoreEl.style.display = "block";
}

bkcore.hexgl.HexGL.prototype.buildBestScoreKey = function () {
	var difficultyKey = this.difficulty == 0 ? 'casual' : 'hard';
	var trackName = (this.track && this.track.name) ? this.track.name : 'unknown';
	return 'hexgl-best-time-' + trackName + '-' + difficultyKey;
}

bkcore.hexgl.HexGL.prototype.getBestTimes = function () {
	if (this.bestTimes == null)
		this.bestTimes = this.loadBestTimesFromStorage();
	return this.bestTimes;
}

bkcore.hexgl.HexGL.prototype.getBestTime = function () {
	var times = this.getBestTimes();
	return times.length > 0 ? times[0] : null;
}

bkcore.hexgl.HexGL.prototype.loadBestTimesFromStorage = function () {
	if (typeof window === "undefined" || window.localStorage == null)
		return [];

	try {
		var value = window.localStorage.getItem(this.bestScoreKey);
		if (value == null)
			return [];

		var parsed;
		try {
			parsed = JSON.parse(value);
		}
		catch (jsonError) {
			parsed = null;
		}

		var times = [];
		if (parsed && parsed instanceof Array) {
			for (var i = 0; i < parsed.length; i++) {
				var num = parseInt(parsed[i], 10);
				if (!isNaN(num))
					times.push(num);
			}
		}
		else {
			var single = parseInt(value, 10);
			if (!isNaN(single))
				times.push(single);
		}

		times.sort(function (a, b) { return a - b; });
		if (times.length > 3)
			times = times.slice(0, 3);

		return times;
	}
	catch (e) {
		console.warn('Unable to read best scores from storage', e);
		return [];
	}
}

bkcore.hexgl.HexGL.prototype.saveBestTime = function (time) {
	if (typeof time !== "number" || isNaN(time)) {
		this.updateBestScoreDisplay();
		return false;
	}

	var currentTimes = this.getBestTimes().slice(0);
	currentTimes.push(time);
	currentTimes.sort(function (a, b) { return a - b; });

	var filtered = [];
	for (var i = 0; i < currentTimes.length; i++) {
		var val = currentTimes[i];
		if (isNaN(val))
			continue;
		if (filtered.indexOf(val) === -1)
			filtered.push(val);
		if (filtered.length === 3)
			break;
	}

	var previous = this.getBestTimes();
	var changed = filtered.length !== previous.length;
	if (!changed) {
		for (var j = 0; j < filtered.length; j++) {
			if (filtered[j] !== previous[j]) {
				changed = true;
				break;
			}
		}
	}

	var previousFirst = previous.length > 0 ? previous[0] : null;
	var newFirst = filtered.length > 0 ? filtered[0] : null;
	var newFirstImproved = (newFirst !== previousFirst) && newFirst === time;

	if (changed) {
		this.bestTimes = filtered;

		if (typeof window !== "undefined" && window.localStorage != null) {
			try {
				window.localStorage.setItem(this.bestScoreKey, JSON.stringify(this.bestTimes));
			}
			catch (e) {
				console.warn('Unable to save best scores to storage', e);
			}
		}
	}

	this.updateBestScoreDisplay();
	return newFirstImproved;
}

bkcore.hexgl.HexGL.prototype.formatTime = function (timeMs) {
	var formatted = bkcore.Timer.msToTimeString(timeMs);
	var ms = formatted.ms;
	if (ms.length > 2)
		ms = ms.substring(0, 2);
	return formatted.m + ":" + formatted.s + ":" + ms;
}

bkcore.hexgl.HexGL.prototype.buildBestTimesLines = function (includeHeader) {
	var labels = ["1st", "2nd", "3rd"];
	var times = this.getBestTimes();
	var lines = [];

	if (includeHeader)
		lines.push("Best Times");

	for (var i = 0; i < labels.length; i++) {
		var display = "--:--:--";
		if (times != null && times[i] != null)
			display = this.formatTime(times[i]);
		lines.push(labels[i] + " " + display);
	}

	return lines;
}
