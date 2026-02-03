import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
	computeBoundsTree, disposeBoundsTree,
	computeBatchedBoundsTree, disposeBatchedBoundsTree, acceleratedRaycast,
	getTriangleHitPointInfo
} from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function coordinateSystem(n, up) {
	if (up === undefined)
		up = Math.abs(n.y) < 0.9
			? new THREE.Vector3(0, 1, 0)
			: new THREE.Vector3(1, 0, 0);

	const x = new THREE.Vector3().crossVectors(up, n).normalize();

	const y = new THREE.Vector3().crossVectors(n, x).normalize();

	return [x, y, n]
}
function lerp(x, y, t) {
	return (1 - t) * x + t * y;
}

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;
THREE.BatchedMesh.prototype.raycast = acceleratedRaycast;

let width = window.innerWidth, height = window.innerHeight;
const dpr = window.devicePixelRatio

const camera = new THREE.PerspectiveCamera(70, width / height, 0.01, 10);
camera.position.set(0, 0, 5);

const scene = new THREE.Scene();

// const geometry = new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
// const geometry = new THREE.TorusGeometry(2, 1, 32)
// const geometry = new THREE.BoxGeometry(1, 1, 1);
const geometry = new THREE.CapsuleGeometry(1, 1, 12, 32, 1);
const material = new THREE.MeshNormalMaterial();

const loader = new GLTFLoader();
// const gltf = await loader.loadAsync('/public/melody.glb');
// const geometries = [];
// gltf.scene.traverse((obj) => {
// 	if (obj.isMesh) {
// 		const geom = obj.geometry.clone();
// 		geom.applyMatrix4(obj.matrixWorld);
// 		geometries.push(geom);
// 	}
// });
// const geometry = mergeGeometries(
// 	geometries,
// 	false
// );
// geometry.scale(0.1, 0.1, 0.1);
const mesh = new THREE.Mesh(geometry, material);
geometry.computeBoundsTree();
scene.add(mesh);

const ambientLight = new THREE.AmbientLight(0xffffff, 100);
scene.add(ambientLight);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(dpr)
renderer.setSize(width, height);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);
window.addEventListener('resize', onWindowResize);

const controls = new OrbitControls(camera, renderer.domElement);
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true

let isDragging = false;
const startCoord = new THREE.Vector2();

window.addEventListener('pointerdown', (e) => {
	isDragging = true;
	startCoord.x = (e.clientX / width) * 2 - 1;
	startCoord.y = -(e.clientY / height) * 2 + 1;

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

let midpointSelectionMode = true
let cameraProjection = true
let cameraAxisAlign = false

let prevAnnotations = []
window.addEventListener('pointermove', (event) => {
	if (!isDragging || controls.enabled) return
	const endCoord = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);

	const nSegments = 20;
	const epsilon = 0.01;


	const annotations = []
	const points = []

	if (cameraProjection) {
		const pA = startCoord;
		const pC = endCoord;
		const aspect = width / height;
		pA.y /= aspect;
		pC.y /= aspect;
		const A = pC.x - pA.x;
		const B = pC.y - pA.y;
		let pB;
		let pD;
		if (cameraAxisAlign) {
			pB = pA.clone().add(pX.clone().multiplyScalar(pC.clone().sub(pA).dot(pX)));
			pD = pA.clone().add(pC).sub(pB);
		} else {
			pB = new THREE.Vector2(pA.x + (A - B) / 2, pA.y + (A + B) / 2);
			pD = new THREE.Vector2(pA.x + (A + B) / 2, pA.y - (A - B) / 2);
		}
		const vertices = [pA, pB, pC, pD];
		vertices.forEach(x => { x.y *= aspect });
		for (let d = 0; d < 4; d++) {
			const v0 = vertices[d];
			const v1 = vertices[(d + 1) % 4];
			for (let i = 0; i <= nSegments; i++) {
				const t = i / nSegments;
				const coord = v0.clone().lerp(v1, t);
				raycaster.setFromCamera(coord, camera);
				const intersects = raycaster.intersectObject(mesh, false);
				if (intersects.length > 0) {
					const intersect = intersects[0];
					points.push(intersect.point.add(intersect.normal.multiplyScalar(epsilon)));
				}
			}
		}
	} else {
		let startPos, endPos;
		{
			raycaster.setFromCamera(startCoord, camera);
			const intersects = raycaster.intersectObject(mesh, false);
			if (intersects.length > 0)
				startPos = intersects[0].point;
		}
		{
			raycaster.setFromCamera(endCoord, camera);
			const intersects = raycaster.intersectObject(mesh, false);
			if (intersects.length > 0)
				endPos = intersects[0].point;
		}
		if (startPos && endPos) {
			let midPoint;
			if (midpointSelectionMode) {
				midPoint = startPos;
				startPos = midPoint.clone().multiplyScalar(2).sub(endPos);
			} else {
				midPoint = startPos.clone().lerp(endPos, 0.5);
			}
			const target = mesh.geometry.boundsTree.closestPointToPoint(midPoint);
			const p = target.point;
			const n = getTriangleHitPointInfo(target.point, mesh.geometry, target.faceIndex).face.normal
			const tbn = coordinateSystem(n);
			const pA = new THREE.Vector2(startPos.clone().sub(p).dot(tbn[0]), startPos.clone().sub(p).dot(tbn[1]));
			const pC = new THREE.Vector2(endPos.clone().sub(p).dot(tbn[0]), endPos.clone().sub(p).dot(tbn[1]));
			const A = pC.x - pA.x;
			const B = pC.y - pA.y;
			let pB;
			let pD;
			const xAxisWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
			const pX = new THREE.Vector2(xAxisWorld.dot(tbn[0]), xAxisWorld.dot(tbn[1]));
			if (cameraAxisAlign) {
				pB = pA.clone().add(pX.clone().multiplyScalar(pC.clone().sub(pA).dot(pX)));
				pD = pA.clone().add(pC).sub(pB);
			} else {
				pB = new THREE.Vector2(pA.x + (A - B) / 2, pA.y + (A + B) / 2);
				pD = new THREE.Vector2(pA.x + (A + B) / 2, pA.y - (A - B) / 2);
			}
			const toWorld = (coord) => { return p.clone().add(tbn[0].clone().multiplyScalar(coord.x)).add(tbn[1].clone().multiplyScalar(coord.y)) };
			const vertices = [pA, pB, pC, pD];
			for (let d = 0; d < 4; d++) {
				const v0 = vertices[d];
				const v1 = vertices[(d + 1) % 4];
				for (let i = 0; i <= nSegments; i++) {
					const t = i / nSegments;
					const coord = v0.clone().lerp(v1, t);
					const worldPos = toWorld(coord).add(n.clone().multiplyScalar(0.1));
					raycaster.set(worldPos, n.clone().negate());
					const intersects = raycaster.intersectObject(mesh, false);
					if (intersects.length > 0) {
						const intersect = intersects[0];
						points.push(intersect.point.add(intersect.normal.clone().multiplyScalar(epsilon)));
					}
				}
			}
		}
	}

	if (points.length > 0) {
		const geometry = new LineGeometry();
		geometry.setFromPoints(points);
		annotations.push(new Line2(geometry, new LineMaterial({ linewidth: 4, vertexColors: true })));
	}
	prevAnnotations.forEach((x) => scene.remove(x))
	annotations.forEach((x) => scene.add(x))
	prevAnnotations = annotations;
});

const UI = document.getElementById('ui');

{
	const btn = document.getElementById('orbitToggle');
	btn.classList.add('pressed');
	const toggleOrbitControl = () => {
		if (controls.enabled) {
			btn.classList.remove('pressed');
			controls.enabled = !controls.enabled;
		}
		else {
			btn.classList.add('pressed');
			controls.enabled = !controls.enabled;
		}
	}
	btn.addEventListener('click', toggleOrbitControl);
	window.addEventListener('keydown', (e) => {
		if (e.key.toLowerCase() === 'q')
			toggleOrbitControl();
	});
	UI.appendChild(btn);
}
{
	const btn = document.getElementById('option0');
	btn.classList.add('pressed');
	btn.addEventListener('click', () => {
		cameraProjection = !cameraProjection;
		if (cameraProjection)
			btn.classList.add('pressed');
		else
			btn.classList.remove('pressed');
	});
	UI.appendChild(btn);
}
{
	const btn = document.getElementById('option1');
	btn.classList.add('pressed');
	btn.addEventListener('click', () => {
		midpointSelectionMode = !midpointSelectionMode;
		if (midpointSelectionMode)
			btn.classList.add('pressed');
		else
			btn.classList.remove('pressed');
	});
	UI.appendChild(btn);
}
{
	const btn = document.getElementById('option2');
	btn.addEventListener('click', () => {
		cameraAxisAlign = !cameraAxisAlign;
		if (cameraAxisAlign)
			btn.classList.add('pressed');
		else
			btn.classList.remove('pressed');
	});
	UI.appendChild(btn);
}

function animate(time) {
	renderer.render(scene, camera);
}

function onWindowResize() {
	width = window.innerWidth
	height = window.innerHeight
	const aspect = width / height;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

	const dpr = renderer.getPixelRatio();
	renderer.setSize(width, height);
}