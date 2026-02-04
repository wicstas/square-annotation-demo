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

function add(a, b) {
	return a.clone().add(b);
}
function sub(a, b) {
	return a.clone().sub(b);
}
function mul(a, b) {
	if (typeof b === 'number')
		return a.clone().multiplyScalar(b);
	else
		return a.clone().multiply(b);
}
function neg(a) {
	return a.clone().negate();
}
// Project x onto v
function proj(v, x) {
	return mul(v, v.dot(x));
}
function lerp(x, y, t) {
	if (typeof x === 'number' && typeof y === 'number')
		return (1 - t) * x + t * y;
	else
		return x.clone().lerp(y, t);
}
function coordinateSystem(n, up) {
	if (up === undefined)
		up = Math.abs(n.y) < 0.9
			? new THREE.Vector3(0, 1, 0)
			: new THREE.Vector3(1, 0, 0);

	const x = new THREE.Vector3().crossVectors(up, n).normalize();

	const y = new THREE.Vector3().crossVectors(n, x).normalize();

	return [x, y, n.clone()]
}
async function sampleGeo(name) {
	if (name == 'melody') {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync('/public/melody.glb');
		const geometries = [];
		gltf.scene.traverse((obj) => {
			if (obj.isMesh) {
				const geom = obj.geometry.clone();
				geom.applyMatrix4(obj.matrixWorld);
				geometries.push(geom);
			}
		});
		return mergeGeometries(
			geometries,
			false
		).scale(0.1, 0.1, 0.1);
	}
	if (name == 'knot')
		return new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
	if (name == 'torus')
		return new THREE.TorusGeometry(2, 1, 32)
	if (name == 'capsule')
		return new THREE.CapsuleGeometry(1, 1, 30, 40, 1);
	else
		alert(`Unknown geometry name ${name}`);
}

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;
THREE.BatchedMesh.prototype.raycast = acceleratedRaycast;

let width = window.innerWidth, height = window.innerHeight;
const dpr = window.devicePixelRatio
window.addEventListener('resize', onWindowResize);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 100);
camera.position.set(0, 0, 5);

const geometry = await sampleGeo('capsule');
const material = new THREE.MeshNormalMaterial();
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

const controls = new OrbitControls(camera, renderer.domElement);
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true

let centerMode = true
let cameraView = false
let cameraAxisAlign = true
let projectionMethod = 'normal'
let shape = "rectangle"
let chain = false
const epsilon = 0.01;
const segmentDensity = 1000;

function buildRectangleVertices(pX, pA, pC, aspect = 1) {
	pA = pA.clone()
	pC = pC.clone()
	pA.y /= aspect;
	pC.y /= aspect;
	const A = pC.x - pA.x;
	const B = pC.y - pA.y;
	let pB;
	let pD;
	if (cameraAxisAlign) {
		pB = add(pA, proj(pX, sub(pC, pA)));
		pD = sub(add(pA, pC), pB);
	} else {
		pB = new THREE.Vector2(pA.x + (A - B) / 2, pA.y + (A + B) / 2);
		pD = new THREE.Vector2(pA.x + (A + B) / 2, pA.y - (A - B) / 2);
	}
	const vertices = [pA, pB, pC, pD]
	vertices.forEach(x => { x.y *= aspect });
	return vertices;
}
function projectLineSegment(v0, v1, projector) {
	const points = []
	const nSegments = segmentDensity * sub(v0, v1).length();
	for (let i = 0; i <= nSegments; i++) {
		const t = i / nSegments;
		const coord = lerp(v0, v1, t);
		const projection = projector(coord);
		if (projection)
			points.push(add(projection.point, mul(projection.normal, epsilon)));
	}
	return points
}
function projectRectangle(vertices, projector) {
	const points = []
	for (let d = 0; d < 4; d++) {
		points.push(...projectLineSegment(vertices[d], vertices[(d + 1) % 4], projector))
	}
	return points
}
function buildCircleVertices(pA, pB, aspect = 1.0) {
	pA = pA.clone()
	pB = pB.clone()
	pA.y /= aspect
	pB.y /= aspect
	const center = lerp(pA, pB, 0.5)
	const radius = sub(pA, pB).length() / 2;
	center.y *= aspect
	return [center, radius, radius * aspect]
}
function projectCircle(center, rX, rY, projector) {
	const points = []
	const nSegments = rX * segmentDensity;
	for (let i = 0; i <= nSegments; i++) {
		const t = i / nSegments * Math.PI * 2;
		const coord = new THREE.Vector2(center.x + rX * Math.cos(t), center.y + rY * Math.sin(t));
		const projection = projector(coord);
		if (projection)
			points.push(add(projection.point, mul(projection.normal, epsilon)));
	}
	return points;
}
function arrayToOptional(a) {
	if (a.length == 0)
		return undefined;
	else
		return a[0];
}
function closestPoint(p) {
	const target = mesh.geometry.boundsTree.closestPointToPoint(p);
	return { p: target.point, n: getTriangleHitPointInfo(target.point, mesh.geometry, target.faceIndex).face.normal };

}

let removeQueue = []
let startCoord;
let isDragging = false;
let tap = true

renderer.domElement.addEventListener('pointerdown', (e) => {
	removeQueue = []
	tap = true

	const coord = new THREE.Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
	if (!startCoord)
		startCoord = coord;
	else {
		drawAnnotation(startCoord, coord);
		if (chain)
			startCoord = coord;
		else
			startCoord = undefined;
	}

	raycaster.setFromCamera(coord, camera);
	const intersects = raycaster.intersectObjects(scene.children, true);
	if (intersects.length > 0) {
		isDragging = true;
		const geometry = new THREE.SphereGeometry(0.01, 8, 8);
		const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(intersects[0].point);
		scene.add(mesh);
	}
});
renderer.domElement.addEventListener('pointerup', (e) => {
	isDragging = false;
	if (!tap)
		startCoord = undefined;
});
renderer.domElement.addEventListener('pointercancel', (e) => {
	isDragging = false;
});
renderer.domElement.addEventListener('pointermove', (e) => {
	tap = false
	if (!isDragging || controls.enabled) return
	const endCoord = new THREE.Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);

	if (startCoord)
		drawAnnotation(startCoord, endCoord);
});
function drawAnnotation(startCoord, endCoord) {
	startCoord = startCoord.clone();
	endCoord = endCoord.clone();
	const annotations = []
	let points;

	if (cameraView) {
		if (centerMode) {
			startCoord = sub(mul(startCoord, 2), endCoord);
		}
		if (shape == 'rectangle') {
			const vertices = buildRectangleVertices(new THREE.Vector2(1, 0), startCoord, endCoord, width / height)
			points = projectRectangle(vertices, coord => {
				raycaster.setFromCamera(coord, camera);
				return arrayToOptional(raycaster.intersectObject(mesh, false));
			});
		} else if (shape == 'circle') {
			const [center, rX, rY] = buildCircleVertices(startCoord, endCoord, width / height)
			points = projectCircle(center, rX, rY, coord => {
				raycaster.setFromCamera(coord, camera);
				return arrayToOptional(raycaster.intersectObject(mesh, false));
			});
		} else if (shape == 'polygon') {
			points = projectLineSegment(startCoord, endCoord, coord => {
				raycaster.setFromCamera(coord, camera);
				return arrayToOptional(raycaster.intersectObject(mesh, false));
			});
		} else {
			alert(`Unknown shape ${shape}`);
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
			let center;
			if (centerMode) {
				center = startPos;
				startPos = sub(mul(center, 2), endPos);
			} else {
				center = lerp(startPos, endPos, 0.5);
			}
			const { p, n } = closestPoint(center);
			const tbn = coordinateSystem(n);
			const toLocal = (v) => { return new THREE.Vector2(v.dot(tbn[0]), v.dot(tbn[1])); };
			const toWorld = (coord) => { return add(add(p, mul(tbn[0], coord.x)), mul(tbn[1], coord.y)); };
			const pA = toLocal(sub(startPos, p));
			const pC = toLocal(sub(endPos, p));
			const pX = toLocal(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion));
			let projector;
			if (projectionMethod == 'normal')
				projector = toWorld => coord => {
					const worldPos = add(toWorld(coord), mul(n, sub(camera.position, p).dot(n)));
					raycaster.set(worldPos, neg(n));
					return arrayToOptional(raycaster.intersectObject(mesh, false));
				}
			else if (projectionMethod == 'distance')
				projector = toWorld => coord => {
					const worldPos = toWorld(coord);
					const target = mesh.geometry.boundsTree.closestPointToPoint(worldPos);
					return { point: target.point, normal: getTriangleHitPointInfo(target.point, mesh.geometry, target.faceIndex).face.normal };
				};
			else
				alert(`Unknown projection method ${projectionMethod}`);

			if (shape == 'rectangle') {
				const vertices = buildRectangleVertices(pX, pA, pC);
				points = projectRectangle(vertices, projector(toWorld));
			} else if (shape == 'circle') {
				const [center, rX, rY] = buildCircleVertices(pA, pC);
				points = projectCircle(center, rX, rY, projector(toWorld));
			} else if (shape == 'polygon') {
				points = projectLineSegment(startPos, endPos, projector(x => x));
			} else {
				alert(`Unknown shape ${shape}`);
			}
		}
	}

	if (points && points.length > 0) {
		const geometry = new LineGeometry();
		geometry.setFromPoints(points);
		annotations.push(new Line2(geometry, new LineMaterial({ linewidth: 4, vertexColors: true })));
	}
	removeQueue.forEach((x) => scene.remove(x))
	annotations.forEach((x) => scene.add(x))
	removeQueue = annotations;
}

function setupToggle(id, getValue, setValue, key) {
	const btn = document.getElementById(id);
	if (getValue())
		btn.classList.add('pressed');
	const callback = () => {
		if (getValue()) {
			btn.classList.remove('pressed');
			setValue(false);
		}
		else {
			btn.classList.add('pressed');
			setValue(true);
		}
	}
	btn.addEventListener('click', callback);

	if (key)
		window.addEventListener('keydown', (e) => {
			if (e.key.toLowerCase() == key)
				callback();
		});
}
setupToggle('orbit-toggle', () => controls.enabled, x => controls.enabled = x, '1');
setupToggle('center-mode', () => centerMode, x => centerMode = x, '2');
setupToggle('camera-view', () => cameraView, x => cameraView = x, '3');
setupToggle('camera-align', () => cameraAxisAlign, x => cameraAxisAlign = x, '4');
setupToggle('chain', () => chain, x => { chain = x; if (!chain) startCoord = undefined }, '5');
document.getElementById('projection-method').addEventListener('change', e => projectionMethod = e.target.value);
document.getElementById('draw-shape').addEventListener('change', e => shape = e.target.value);
document.getElementById("projection-method").value = projectionMethod
document.getElementById("draw-shape").value = shape

window.addEventListener('keydown', (e) => {
	if (e.key == "Escape")
		startCoord = undefined;
});

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