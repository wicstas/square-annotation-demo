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
import { remove } from 'three/examples/jsm/libs/tween.module.js';

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
	const vertexArray = [pA, pB, pC, pD]
	vertexArray.forEach(x => { x.y *= aspect });
	return vertexArray;
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
	const axis = toLocal(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)).normalize();
	return [toWorld, axis, ...points.map((point) => toLocal(sub(point, p)))];
}
function pathLength(points) {
	let totalLength = 0;
	for (let i = 0; i < points.length - 1; i++)
		totalLength += sub(points[i], points[i + 1]).length();
	return totalLength;
}

let removeQueue = [];
let gVertexArray = [];
let expectedNextVertex;
let expectedVertexPointMesh;
let released = true;
let moved = false;
let labelUpdators = [];
let activeLabels = [];

function commitAnnotations() {
	removeQueue = [];
	gVertexArray = [];
	activeLabels = [];
}
function updateLabel(div, worldPos) {
	const v = worldPos.clone().project(camera);
	const x = (v.x * 0.5 + 0.5) * width;
	const y = (-v.y * 0.5 + 0.5) * height;

	div.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
}
function updateLabels() {
	labelUpdators.forEach(labelUpdator => labelUpdator());
}

function addVertex(coord) {
	const position = cameraRayIntersection(coord)?.point;
	if (screenspaceProjection)
		gVertexArray.push(coord);
	else if (position)
		gVertexArray.push(position);

	if (position) {
		const geometry = new THREE.SphereGeometry(0.02, 8, 8);
		const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(position);
		scene.add(mesh);
	}
}
function createPath(points) {
	const geometry = new LineGeometry();
	geometry.setFromPoints(points);
	return new Line2(geometry, new LineMaterial({ linewidth: 4, vertexColors: true }));
}

renderer.domElement.addEventListener('pointerdown', (e) => {
	if (!controls.enabled) {
		let coord = new THREE.Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
		addVertex(coord);
		removeQueue.forEach((x) => scene.remove(x));
		const { annotations, shouldCommit } = drawAnnotations({});
		if (shouldCommit)
			removeQueue = annotations;
	}

	released = false;
	moved = false;
});
renderer.domElement.addEventListener('pointerup', (e) => {
	if ((controls.enabled && !moved) || (!controls.enabled && moved)) {
		let coord = new THREE.Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
		addVertex(coord);
		drawAnnotations({});
	}
	released = true;
});
renderer.domElement.addEventListener('pointercancel', (e) => {
	released = true;
});
renderer.domElement.addEventListener('pointermove', (e) => {
	moved = true;
	if (!released && controls.enabled)
		return;
	const coord = new THREE.Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);

	const position = cameraRayIntersection(coord)?.point;
	if (screenspaceProjection)
		expectedNextVertex = coord;
	else if (position)
		expectedNextVertex = position;

	if (position) {
		scene.remove(expectedVertexPointMesh);
		const geometry = new THREE.SphereGeometry(0.02, 8, 8);
		const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
		expectedVertexPointMesh = new THREE.Mesh(geometry, material);
		expectedVertexPointMesh.position.copy(position);
		scene.add(expectedVertexPointMesh);
	}

	drawAnnotations({ previewNextVertex: true });
});
function createLabel(position) {
	const label = document.createElement('div');
	activeLabels.push(label);
	label.className = 'label';
	document.body.appendChild(label);
	label.style.whiteSpace = 'pre-wrap';
	labelUpdators.push(() => {
		updateLabel(label, position);
	});
	return label;
}
function polygonArea(vertices, projector) {
	let area = 0;
	for (let i = 0; i < vertices.length - 1; i++) {
		const v0 = projector(vertices[i]);
		const v1 = projector(vertices[i + 1]);
		area += v1.y * v0.x - v1.x * v0.y;
	}
	return Math.abs(area) / 2;
}
function drawAnnotations({ previewNextVertex = false, completePath = false, shouldCommit = false }) {
	removeQueue.forEach((x) => scene.remove(x));

	let vertexArray = [...gVertexArray];
	if (previewNextVertex) vertexArray.push(expectedNextVertex);
	const annotations = []

	if (shape == 'rectangle') {
		for (let i = 0; i < Math.trunc(vertexArray.length / 2); i++) {
			let p0 = vertexArray[i * 2].clone();
			let p1 = vertexArray[i * 2 + 1].clone();
			if (centerMode)
				p0 = sub(mul(p0, 2), p1);
			const pc = lerp(p0, p1, 0.5);

			let vertices;
			let area = 0;
			if (screenspaceProjection) {
				position = cameraRayIntersection(p0)?.point;
				vertices = buildRectangleVertices(new THREE.Vector2(1, 0), p0, p1, width / height);
				vertices = projectRectangle(vertices, cameraRayIntersection);
				// area = 
			} else {
				const { point: p, normal: n } = closestPoint(pc);
				const [toWorld, axis, pA, pC] = buildPlanarSystem(p, n, p0, p1);
				vertices = buildRectangleVertices(axis, pA, pC, width / height);
				if (projectionMethod == 'normal')

					vertices = projectRectangle(vertices, coord => {
						const worldPos = add(toWorld(coord), mul(n, sub(camera.position, p).dot(n)));
						raycaster.set(worldPos, neg(n));
						return arrayToOptional(raycaster.intersectObject(mesh, false));
					});
				else if (projectionMethod == 'distance')
					vertices = projectRectangle(vertices, coord => closestPoint(toWorld(coord)));
			}
			annotations.push(createPath(vertices));

			if (vertices && vertices.length > 0) {
				if (i >= activeLabels.length)
					createLabel(vertices[0]);
				const length = pathLength(vertices).toFixed(2);
				// const area = polygonArea(vertices, );
				activeLabels[i].textContent = `length: ${length}\narea: ${area}`;
			}
		}
	} else if (shape == 'circle') {
		for (let i = 0; i < Math.trunc(vertexArray.length / 2); i++) {
			let p0 = vertexArray[i * 2].clone();
			let p1 = vertexArray[i * 2 + 1].clone();
			if (centerMode)
				p0 = sub(mul(p0, 2), p1);
			const pc = lerp(p0, p1, 0.5);
			const area = sub(p0, p1).length() * Math.PI / 4;

			let vertices;
			if (screenspaceProjection) {
				vertices = projectCircle(p0, p1, width / height, cameraRayIntersection);
			} else {
				const { point: p, normal: n } = closestPoint(pc);
				const [toWorld, axis, pA, pC] = buildPlanarSystem(p, n, p0, p1);
				if (projectionMethod == 'normal')
					vertices = projectCircle(pA, pC, 1, coord => {
						const worldPos = add(toWorld(coord), mul(n, sub(camera.position, p).dot(n)));
						raycaster.set(worldPos, neg(n));
						return arrayToOptional(raycaster.intersectObject(mesh, false));
					});
				else if (projectionMethod == 'distance')
					vertices = projectCircle(pA, pC, 1, coord => closestPoint(toWorld(coord)));
			}
			annotations.push(createPath(vertices));

			if (vertices && vertices.length > 0) {
				if (i >= activeLabels.length)
					createLabel(vertices[0]);
				activeLabels[i].textContent = `length: ${pathLength(vertices).toFixed(2)}\narea: ${area}`;
			}
		}
	} else if (shape == 'polygon') {
		for (let i = 0; i < (completePath ? vertexArray.length : vertexArray.length - 1); i++) {
			let p0 = vertexArray[i].clone();
			let p1 = vertexArray[(i + 1) % vertexArray.length].clone();

			let vertices;
			if (screenspaceProjection)
				vertices = projectLineSegment(p0, p1, cameraRayIntersection);
			else
				vertices = projectLineSegment(p0, p1, closestPoint);
			annotations.push(createPath(vertices));

			if (vertices && vertices.length > 0) {
				if (i >= activeLabels.length)
					createLabel(vertices[0]);
				activeLabels[i].textContent = `length: ${pathLength(vertices).toFixed(2)}`;
			}
		}
	} else if (shape == 'spline') {
		if (vertexArray.length > 1) {
			if (screenspaceProjection)
				vertexArray = vertexArray.map(v => new THREE.Vector3(v.x, v.y, 0));
			let totalLength = 0;
			for (let i = 0; i < vertexArray.length - 1; i++)
				totalLength += sub(vertexArray[i], vertexArray[i + 1]).length();
			const nSegments = segmentDensity * totalLength;
			let curve = new THREE.CatmullRomCurve3(vertexArray);
			if (completePath)
				curve.closed = true;
			let vertices = curve.getPoints(nSegments);
			if (screenspaceProjection)
				vertices = vertices.map(p => {
					const projection = cameraRayIntersection(new THREE.Vector2(p.x, p.y));
					if (projection)
						return add(projection.point, mul(projection.normal, epsilon));
					else
						return null;
				}).filter(p => p);
			else
				vertices = vertices.map(p => {
					const projection = closestPoint(p);
					if (projection)
						return add(projection.point, mul(projection.normal, epsilon));
					else
						return null;
				}).filter(p => p);
			annotations.push(createPath(vertices));

			if (vertices && vertices.length > 0) {
				if (0 >= activeLabels.length)
					createLabel(vertices[0]);
				activeLabels[0].textContent = `length: ${pathLength(vertices).toFixed(2)}`;
			}
		}
	}

	annotations.forEach((x) => scene.add(x));
	if (shouldCommit)
		commitAnnotations();
	else
		removeQueue = annotations;

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
		document.getElementById('center-mode').disabled = false;
		document.getElementById('camera-align').disabled = false;
		optionNormalElement.disabled = false;
	}
	else if (shape == 'circle') {
		document.getElementById('center-mode').disabled = false;
		document.getElementById('camera-align').disabled = true;
		optionNormalElement.disabled = false;
	}
	else {
		document.getElementById('center-mode').disabled = true;
		document.getElementById('camera-align').disabled = true;
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
		drawAnnotations({ completePath: true, shouldCommit: true }).forEach((x) => scene.add(x));
	} if (e.key == 'Escape') {
		scene.remove(expectedVertexPointMesh);
		removeQueue.forEach((x) => scene.remove(x));
		drawAnnotations({ completePath: false, shouldCommit: true }).forEach((x) => scene.add(x));
		commitAnnotations();
	}
});

function animate(time) {
	renderer.render(scene, camera);
	updateLabels();
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