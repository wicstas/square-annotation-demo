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

let width = window.innerWidth;
let height = window.innerHeight;
let aspect = width / height;
const dpr = window.devicePixelRatio;
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

let centerMode = false
let screenspaceProjection = false
let cameraAxisAlign = true
let projectionMethod = 'normal'
let shape = "rectangle"
const epsilon = 0.01;
const segmentDensity = 100;

function buildRectangleVertices(axis, pA, pC, aspect = 1) {
	pA = pA.clone()
	pC = pC.clone()
	pA.y /= aspect;
	pC.y /= aspect;
	const A = pC.x - pA.x;
	const B = pC.y - pA.y;
	let pB;
	let pD;
	if (cameraAxisAlign) {
		pB = add(pA, proj(axis, sub(pC, pA)));
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
function projectRectangle(axis, pA, pC, aspect, projector) {
	const vertices = buildRectangleVertices(axis, pA, pC, aspect)

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
function projectCircle(pA, pB, aspect, projector) {
	const [center, rX, rY] = buildCircleVertices(pA, pB, aspect);
	const points = []
	const nSegments = rX * 2 * Math.PI * segmentDensity;
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
	return { point: target.point, normal: getTriangleHitPointInfo(target.point, mesh.geometry, target.faceIndex).face.normal };

}
function cameraRayIntersection(coord) {
	raycaster.setFromCamera(coord, camera);
	const intersects = raycaster.intersectObject(mesh, false);
	if (intersects.length > 0)
		return intersects[0];
	else
		return null;
}
function buildPlanarSystem(p, n, ...points) {
	const tbn = coordinateSystem(n);
	const toLocal = (v) => { return new THREE.Vector2(v.dot(tbn[0]), v.dot(tbn[1])); };
	const toWorld = (coord) => { return add(add(p, mul(tbn[0], coord.x)), mul(tbn[1], coord.y)); };
	const axis = toLocal(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion));
	return [toWorld, axis, ...points.map((point) => toLocal(sub(point, p)))];
}

let removeQueue = []
let isDragging = false;
let vertexArray = [];
let noMovement = true;
let firstMovement = true;
let tentativeCoord;
let lastPointMesh;

function commitAnnotations() {
	removeQueue = [];
	vertexArray = [];
}
function addVertex(coord) {
	const position = cameraRayIntersection(coord)?.point;
	if (screenspaceProjection)
		vertexArray.push(coord);
	else if (position)
		vertexArray.push(position);


	if (position) {
		const geometry = new THREE.SphereGeometry(0.02, 8, 8);
		const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
		lastPointMesh = new THREE.Mesh(geometry, material);
		lastPointMesh.position.copy(position);
		scene.add(lastPointMesh);
	}
}
function updateLastVertex(coord) {
	const position = cameraRayIntersection(coord)?.point;
	if (screenspaceProjection)
		vertexArray[vertexArray.length - 1] = coord;
	else if (position)
		vertexArray[vertexArray.length - 1] = position;

	if (position) {
		scene.remove(lastPointMesh);
		const geometry = new THREE.SphereGeometry(0.02, 8, 8);
		const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
		lastPointMesh = new THREE.Mesh(geometry, material);
		lastPointMesh.position.copy(position);
		scene.add(lastPointMesh);
	}
}
function createLine(points) {
	const geometry = new LineGeometry();
	geometry.setFromPoints(points);
	return new Line2(geometry, new LineMaterial({ linewidth: 4, vertexColors: true }));
}

renderer.domElement.addEventListener('pointerdown', (e) => {
	tentativeCoord = new THREE.Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);

	isDragging = true;
	noMovement = true;
	firstMovement = true;

	if (!controls.enabled)
		addVertex(tentativeCoord);

	const annotations = drawAnnotations();
	removeQueue.forEach((x) => scene.remove(x));
	annotations.forEach((x) => scene.add(x));
	removeQueue = annotations;
});
renderer.domElement.addEventListener('pointerup', (e) => {
	isDragging = false;

	if (controls.enabled && noMovement)
		addVertex(tentativeCoord);

	const annotations = drawAnnotations();
	removeQueue.forEach((x) => scene.remove(x));
	annotations.forEach((x) => scene.add(x));
	removeQueue = annotations;
});
renderer.domElement.addEventListener('pointercancel', (e) => {
	isDragging = false;
});
renderer.domElement.addEventListener('pointermove', (e) => {
	noMovement = false;
	if (!isDragging || controls.enabled)
		return;
	const coord = new THREE.Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);

	if (firstMovement)
		addVertex(coord);
	else
		updateLastVertex(coord);
	firstMovement = false;

	const annotations = drawAnnotations();
	removeQueue.forEach((x) => scene.remove(x));
	annotations.forEach((x) => scene.add(x));
	removeQueue = annotations;
});
function drawAnnotations(completePath) {
	const annotations = []

	if (shape == 'rectangle') {
		for (let i = 0; i < vertexArray.length - 1; i += 2) {
			let p0 = vertexArray[i].clone();
			let p1 = vertexArray[i + 1].clone();
			if (centerMode)
				p0 = sub(mul(p0, 2), p1);
			const pc = lerp(p0, p1, 0.5);

			if (screenspaceProjection) {
				annotations.push(createLine(projectRectangle(new THREE.Vector2(1, 0), p0, p1, width / height, cameraRayIntersection)));
			} else {
				const { point: p, normal: n } = closestPoint(pc);
				const [toWorld, axis, pA, pC] = buildPlanarSystem(p, n, p0, p1);
				if (projectionMethod == 'normal')
					annotations.push(createLine(projectRectangle(axis, pA, pC, 1, coord => {
						const worldPos = add(toWorld(coord), mul(n, sub(camera.position, p).dot(n)));
						raycaster.set(worldPos, neg(n));
						return arrayToOptional(raycaster.intersectObject(mesh, false));
					})));
				else if (projectionMethod == 'distance')
					annotations.push(createLine(projectRectangle(axis, pA, pC, 1, coord => closestPoint(toWorld(coord)))));
			}
		}
	} else if (shape == 'circle') {
		for (let i = 0; i < vertexArray.length - 1; i += 2) {
			let p0 = vertexArray[i].clone();
			let p1 = vertexArray[i + 1].clone();
			if (centerMode)
				p0 = sub(mul(p0, 2), p1);
			const pc = lerp(p0, p1, 0.5);

			if (screenspaceProjection) {
				annotations.push(createLine(projectCircle(p0, p1, width / height, cameraRayIntersection)));
			} else {
				const { point: p, normal: n } = closestPoint(pc);
				const [toWorld, axis, pA, pC] = buildPlanarSystem(p, n, p0, p1);
				if (projectionMethod == 'normal')
					annotations.push(createLine(projectCircle(pA, pC, 1, coord => {
						const worldPos = add(toWorld(coord), mul(n, sub(camera.position, p).dot(n)));
						raycaster.set(worldPos, neg(n));
						return arrayToOptional(raycaster.intersectObject(mesh, false));
					})));
				else if (projectionMethod == 'distance')
					annotations.push(createLine(projectCircle(pA, pC, 1, coord => closestPoint(toWorld(coord)))));
			}
		}
	} else if (shape == 'polygon') {
		for (let i = 0; i < (completePath ? vertexArray.length : vertexArray.length - 1); i++) {
			let p0 = vertexArray[i].clone();
			let p1 = vertexArray[(i + 1) % vertexArray.length].clone();

			if (screenspaceProjection) {
				annotations.push(createLine(projectLineSegment(p0, p1, cameraRayIntersection)));
			} else {
				annotations.push(createLine(projectLineSegment(p0, p1, closestPoint)));
			}
		}
	} else if (shape == 'spline') {
		if (vertexArray.length > 1) {
			let vertices = [...vertexArray];
			if (screenspaceProjection)
				vertices = vertexArray.map(x => new THREE.Vector3(x, 0));
			let totalLength = 0;
			for (let i = 0; i < vertices.length - 1; i++)
				totalLength += sub(vertices[i], vertices[i + 1]).length();
			const nSegments = segmentDensity * totalLength;
			let curve = new THREE.CatmullRomCurve3(vertices);
			if (completePath)
				curve.closed = true;
			let points = curve.getPoints(nSegments);
			if (screenspaceProjection)
				points = points.map(p => {
					const projection = cameraRayIntersection(p);
					if (projection)
						return add(projection.point, mul(projection.normal, epsilon));
					else
						return null;
				}).filter(p => p);
			else
				points = points.map(p => {
					const projection = closestPoint(p);
					if (projection)
						return add(projection.point, mul(projection.normal, epsilon));
					else
						return null;
				}).filter(p => p);
			annotations.push(createLine(points));
		}
	}

	return annotations;
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

	return btn;
}
setupToggle('orbit-toggle', () => controls.enabled, x => {
	controls.enabled = x;
	commitAnnotations();
}, '1');
setupToggle('center-mode', () => centerMode, x => {
	centerMode = x;
	commitAnnotations();
}, '2');
setupToggle('screen-space', () => screenspaceProjection, x => {
	screenspaceProjection = x;
	commitAnnotations();
}, '3');
setupToggle('camera-align', () => cameraAxisAlign, x => {
	cameraAxisAlign = x;
	commitAnnotations();
}, '4');
document.getElementById('projection-method').addEventListener('change', e => {
	projectionMethod = e.target.value;
	commitAnnotations();
});

const projectionMethodElement = document.getElementById("projection-method");
const optionNormalElement = projectionMethodElement.querySelector('option[value="normal"]');

document.getElementById('draw-shape').addEventListener('change', e => {
	shape = e.target.value;
	if (shape == 'rectangle') {
		document.getElementById('center-mode').style.display = 'block';
		optionNormalElement.disabled = false;
	}
	if (shape == 'circle') {
		document.getElementById('center-mode').style.display = 'block';
		optionNormalElement.disabled = false;
	}
	if (shape == 'polygon') {
		document.getElementById('center-mode').style.display = 'none';
		optionNormalElement.disabled = true;
		projectionMethod = 'distance';
	}
	commitAnnotations();
});
document.getElementById("projection-method").value = projectionMethod
document.getElementById("draw-shape").value = shape
window.addEventListener('keydown', (e) => {
	if (e.key == 'Enter') {
		removeQueue.forEach((x) => scene.remove(x));
		drawAnnotations(true).forEach((x) => scene.add(x));
		commitAnnotations();
	}

});

function animate(time) {
	renderer.render(scene, camera);
}

function onWindowResize() {
	width = window.innerWidth
	height = window.innerHeight
	aspect = width / height;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();

	const dpr = renderer.getPixelRatio();
	renderer.setSize(width, height);
}