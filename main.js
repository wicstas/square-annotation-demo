import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';

const width = window.innerWidth, height = window.innerHeight;
const dpr = window.devicePixelRatio

let postCamera;
let postScene;
function setupPost() {
	postCamera = new THREE.OrthographicCamera(- 1, 1, 1, - 1, 0, 1);
	const postMaterial = new THREE.ShaderMaterial({
		vertexShader: `
			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
				`,
		fragmentShader: `
		varying vec2 vUv;
			uniform sampler2D tDiffuse;
			uniform sampler2D tDepth;
			uniform float cameraNear;
			uniform float cameraFar;


			float readDepth( sampler2D depthSampler, vec2 coord ) {
				float fragCoordZ = texture2D( depthSampler, coord ).x;
				float viewZ = ( cameraNear * cameraFar ) / ( ( cameraFar - cameraNear ) * fragCoordZ - cameraFar );
				return ( viewZ + cameraNear ) / ( cameraNear - cameraFar );
			}

			void main() {
				//vec3 diffuse = texture2D( tDiffuse, vUv ).rgb;
				float depth = readDepth( tDepth, vUv );

				gl_FragColor.rgb = 1.0 - vec3( depth );
				gl_FragColor.a = 1.0;
			}
			`,
		uniforms: {
			cameraNear: { value: camera.near },
			cameraFar: { value: camera.far },
			tDiffuse: { value: null },
			tDepth: { value: null }
		}
	});
	const postPlane = new THREE.PlaneGeometry(2, 2);
	const postQuad = new THREE.Mesh(postPlane, postMaterial);
	postScene = new THREE.Scene();
	postScene.add(postQuad);
}
function setupDepthRenderTarget(width, height, dpr) {
	const renderTarget = new THREE.WebGLRenderTarget(width * dpr, height * dpr, {
		depthBuffer: true,
		stencilBuffer: false
	});
	renderTarget.texture.generateMipmaps = false;
	renderTarget.stencilBuffer = false;
	renderTarget.depthTexture = new THREE.DepthTexture();
	renderTarget.depthTexture.type = THREE.UnsignedShortType;
	return renderTarget;
}

const camera = new THREE.PerspectiveCamera(70, width / height, 0.01, 10);
camera.position.set(0, 0, 5);

const scene = new THREE.Scene();

// const geometry = new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
const geometry = new THREE.TorusGeometry(2, 1, 32);
const material = new THREE.MeshNormalMaterial();
scene.add(new THREE.Mesh(geometry, material));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(dpr)
renderer.setSize(width, height);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

// const renderTarget = setupDepthRenderTarget(width, height, dpr);
// renderer.setRenderTarget(renderTarget);

// setupPost();
window.addEventListener('resize', onWindowResize);

const controls = new OrbitControls(camera, renderer.domElement);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function lerp(x, y, t) {
	return (1 - t) * x + t * y;
}

let isDragging = false;
const startCoord = new THREE.Vector2();

window.addEventListener('pointerdown', (e) => {
	isDragging = true;
	startCoord.x = (e.clientX / window.innerWidth) * 2 - 1;
	startCoord.y = -(e.clientY / window.innerHeight) * 2 + 1;

	raycaster.setFromCamera(startCoord, camera);
	const intersects = raycaster.intersectObjects(scene.children, true);
	if (intersects.length == 0)
		isDragging = false
});
window.addEventListener('pointerup', (e) => {
	isDragging = false;
});
window.addEventListener('pointercancel', (e) => {
	isDragging = false;
});

let orbitControlEnabled = true

let prevLine
window.addEventListener('pointermove', (event) => {
	if (!isDragging || orbitControlEnabled) return
	console.log("move")
	mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
	mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

	const nSegments = 20;
	const epsilon = 1e-2;

	const points = [];
	const directions = [[startCoord.x, startCoord.y, mouse.x, startCoord.y], [mouse.x, startCoord.y, mouse.x, mouse.y], [mouse.x, mouse.y, startCoord.x, mouse.y], [startCoord.x, mouse.y, startCoord.x, startCoord.y],]
	for (let d = 0; d < 4; d++)
		for (let i = 0; i <= nSegments; i++) {
			const t = i / nSegments;
			const coord = new THREE.Vector2(lerp(directions[d][0], directions[d][2], t), lerp(directions[d][1], directions[d][3], t))
			raycaster.setFromCamera(coord, camera);
			const intersects = raycaster.intersectObject(mesh, false);
			if (intersects.length > 0) {
				const intersect = intersects[0];
				console.log(intersect)
				if (intersect.normal)
					points.push(intersect.point.add(intersect.normal.multiplyScalar(epsilon)));
			}
		}

	const geometry = new LineGeometry();
	geometry.setFromPoints(points);
	const line = new Line2(geometry, new LineMaterial({ linewidth: 4, vertexColors: true }));
	if (prevLine)
		scene.remove(prevLine)
	scene.add(line);
	prevLine = line
});

const btn = document.createElement('button');
btn.id = 'toggleOrbitControl';
btn.textContent = 'Toggle Orbit Control';

const toggleOrbitControl = () => {
	if (orbitControlEnabled) {
		btn.classList.add('pressed');
		controls.disconnect();
		orbitControlEnabled = false;
	}
	else {
		btn.classList.remove('pressed');
		console.log(btn.classList)
		controls.connect(renderer.domElement);
		orbitControlEnabled = true
	}
}
btn.addEventListener('click', toggleOrbitControl);
window.addEventListener('keydown', (e) => {
	if (e.key.toLowerCase() === 'q')
		toggleOrbitControl();
});

document.body.appendChild(btn);

function animate(time) {
	renderer.render(scene, camera);
	controls.update();
}

function onWindowResize() {
	const aspect = window.innerWidth / window.innerHeight;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

	const dpr = renderer.getPixelRatio();
	renderTarget.setSize(window.innerWidth * dpr, window.innerHeight * dpr);
	renderer.setSize(window.innerWidth, window.innerHeight);

}