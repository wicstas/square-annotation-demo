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

function add(a, b, ...args) {
	let result = a.clone().add(b);
	for (const x of args)
		result.add(x);
	return result;
}
function sub(a, b) {
	return a.clone().sub(b);
}
function cross(a, b) {
	return a.clone().cross(b);
}
function dot(a, b) {
	return a.dot(b);
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

const geometry = await sampleGeo('melody');
geometry.computeVertexNormals()
geometry.scale(20, 20, 20)
const material = new THREE.MeshNormalMaterial();
const mesh = new THREE.Mesh(geometry, material);
geometry.computeBoundsTree();
scene.add(mesh);

const ambientLight = new THREE.AmbientLight(0xffffff, 100);
scene.add(ambientLight);
const box = new THREE.Box3().setFromObject(mesh);
const size = new THREE.Vector3();
box.getSize(size);
const sceneScaleRef = 1 / 3 * (box.max.z - box.min.z + box.max.y - box.min.y + box.max.x - box.min.x)

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
const segmentDensity = 500 / sceneScaleRef;

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
	if (nSegments)
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
	const toWorld = (coord) => { return add(p, mul(tbn[0], coord.x), mul(tbn[1], coord.y)); };
	const axis = toLocal(cross(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), n)).normalize();
	return [toLocal, toWorld, axis, ...points.map((point) => toLocal(sub(point, p)))];
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
let labels = [];
let activeLabels = [];

function commitAnnotations() {
	removeQueue = [];
	gVertexArray = [];
	activeLabels = [];
}
function updateLabel({ label: div, position }) {
	const ndc = position.clone().project(camera);
	const intersection = cameraRayIntersection(ndc);
	div.style.opacity = 1;
	if (intersection)
		if (intersection.distance < sub(position, camera.position).length())
			div.style.opacity = 0.3;
	const x = (ndc.x * 0.5 + 0.5) * width;
	const y = (-ndc.y * 0.5 + 0.5) * height;

	div.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
}
function updateLabels() {
	labels.forEach(updateLabel);
}

function addVertex(coord) {
	const intersection = cameraRayIntersection(coord);
	if (screenspaceProjection)
		gVertexArray.push(coord);
	else if (intersection)
		gVertexArray.push(intersection);

	if (intersection) {
		const geometry = new THREE.SphereGeometry(0.02, 8, 8);
		const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(intersection.point);
		scene.add(mesh);
	}
}
function createPath(points) {
	const geometry = new LineGeometry();
	if (points.length > 0)
		geometry.setFromPoints(points);
	return new Line2(geometry, new LineMaterial({ linewidth: 2, vertexColors: true }));
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

	const intersection = cameraRayIntersection(coord);
	if (screenspaceProjection)
		expectedNextVertex = coord;
	else
		expectedNextVertex = intersection;

	if (intersection) {
		scene.remove(expectedVertexPointMesh);
		const geometry = new THREE.SphereGeometry(0.02, 8, 8);
		const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
		expectedVertexPointMesh = new THREE.Mesh(geometry, material);
		expectedVertexPointMesh.position.copy(intersection.point);
		scene.add(expectedVertexPointMesh);
	}

	drawAnnotations({ previewNextVertex: true });
});
function createLabel(loc, position) {
	for (let j = 0; j < loc - activeLabels.length; j++)
		activeLabels.push(null);

	const label = document.createElement('div');
	activeLabels.push(label);
	label.className = 'label';
	document.body.appendChild(label);
	label.style.whiteSpace = 'pre-wrap';
	labels.push({ label, position });
	return label;
}
function polygonArea(vertices, projector = x => x) {
	let totalAreaSquared = 0;
	let area = 0;
	for (let d = 0; d < 3; d++)
		for (let i = 0; i < vertices.length - 1; i++) {
			const v0 = projector(vertices[i]);
			const v1 = projector(vertices[i + 1]);
			area += v1.getComponent((d + 1) % 3) * v0.getComponent(d % 3) - v0.getComponent((d + 1) % 3) * v1.getComponent(d % 3);
		}
	totalAreaSquared += area * area / 2;
	return Math.sqrt(totalAreaSquared);
}
function mod(i, n) {
	if (i < 0)
		return (n + i % n) % n;
	else
		return i % n;
}
function cyclic(arr, i) {
	return arr[mod(i, arr.length)];
}
function clamped(arr, i) {
	if (i < 0)
		return arr[0];
	else if (i >= arr.length)
		return arr[arr.length - 1];
	else
		return arr[i]
}
function deBoor(k, r, j, t, d, closed) {
	if (r == 0)
		return closed ? cyclic(d, j) : clamped(d, j);
	let t0 = j
	let t1 = j + k - (r - 1);
	const w = (t - t0) / (t1 - t0);
	return lerp(deBoor(k, r - 1, j - 1, t, d, closed), deBoor(k, r - 1, j, t, d, closed), w);
}
function deBoorHalf(k, n, t, d, closed) {
	if (k == 0)
		return closed ? cyclic(d, n) : clamped(d, n);
	return lerp(deBoorHalf(k - 1, n - 1, t / 2 + 0.5, d, closed), deBoorHalf(k - 1, n, t / 2, d, closed), t);
}
function solve(a, b, c, d, b0, b1) {
	return [add(mul(b0, d / (a * d - b * c)), mul(b1, -b / (a * d - b * c)))
		, add(mul(b0, -c / (a * d - b * c)), mul(b1, a / (a * d - b * c)))];
}
function solveTridiagonal(a, b, d, crossEntry) {
	const r = d.map(x => x.clone());
	const n = r.length;
	if (n < 2)
		alert("`solveTridiagonal` called with too small array");
	const A = 1 / a, B = 1 / b;

	r[0] = mul(r[0], A);
	for (let i = 1; i < n - 1; i++)
		r[i] = mul(r[i], B);
	r[n - 1] = mul(r[n - 1], A);

	const coefs = new Array(n - 1).fill(0)
	coefs[0] = A

	let cc = A;
	for (let i = 1; i < n - 1; i++) {
		const c = 1 - cc * B;
		r[i] = mul(sub(r[i], mul(r[i - 1], B)), 1 / c);
		cc = B / c;
		coefs[i] = cc;
	}
	const c = 1 - cc * A;
	r[n - 1] = mul(sub(r[n - 1], mul(r[n - 2], A)), 1 / c);

	for (let i = n - 2; i >= 0; i--)
		r[i] = sub(r[i], mul(r[i + 1], coefs[i]));

	if (crossEntry) {
		const first_col = new Array(n).fill(0)
		first_col[0] = 1
		first_col[1] = B
		first_col[n - 1] = A
		const last_col = new Array(n).fill(0)
		last_col[0] = A;
		last_col[n - 2] = B;
		last_col[n - 1] = 1;
		for (let i = 1; i < n; i++) {
			const C = i == n - 1 ? A : B;
			first_col[i] = (first_col[i] - C * first_col[i - 1]) / (1 - coefs[i - 1] * C);
			last_col[i] = (last_col[i] - C * last_col[i - 1]) / (1 - coefs[i - 1] * C);
		}
		for (let i = n - 2; i >= 0; i--) {
			first_col[i] = first_col[i] - coefs[i] * first_col[i + 1];
			last_col[i] = last_col[i] - coefs[i] * last_col[i + 1];
		}
		const [r0, rn_1] = solve(first_col[0], last_col[0], first_col[n - 1], last_col[n - 1], r[0], r[n - 1]);
		for (let i = 1; i < n - 1; i++)
			r[i] = sub(r[i], add(mul(r0, first_col[i]), mul(rn_1, last_col[i])));
		r[0] = r0;
		r[n - 1] = rn_1;
	}

	return r;
}
// console.log(solveTridiagonal(4, 4, [new THREE.Vector2(1, 2), new THREE.Vector2(3, 4), new THREE.Vector2(5, 6)], true));

function createSpline(method, vertexArray, nSegments, closed, uniformSpace) {
	if (method == 'catmull-rom') {
		if (vertexArray.length < 2)
			return [];
		let curve = new THREE.CatmullRomCurve3(vertexArray);
		curve.closed = closed;
		return curve.getPoints(nSegments);
	} else if (method == 'cubic') {
		if (vertexArray.length < 2)
			return [];
		const input = vertexArray;
		const n = input.length - 1;
		const Y = [];
		if (closed)
			Y.push(mul(sub(input[1], input[n]), 3));
		else
			Y.push(mul(sub(input[1], input[0]), 3));

		for (let i = 2; i <= n; i++)
			Y.push(mul(sub(input[i], input[i - 2]), 3));

		if (closed)
			Y.push(mul(sub(input[0], input[n - 1]), 3));
		else
			Y.push(mul(sub(input[n], input[n - 1]), 3));

		const D = solveTridiagonal(closed ? 4 : 2, 4, Y, closed);

		const vertices = []
		let totalLength = 0;
		const lengths = [];
		if (!uniformSpace)
			for (let s = 0; s < (closed ? n + 1 : n); s++) {
				const r = sub(cyclic(input, s), cyclic(input, s + 1)).length();
				lengths.push(r);
				totalLength += r;
			}
		for (let s = 0; s < (closed ? n + 1 : n); s++) {
			const a = cyclic(input, s);
			const b = D[s];
			const c = sub(mul(sub(cyclic(input, s + 1), cyclic(input, s)), 3), add(cyclic(D, s + 1), mul(D[s], 2)));
			const d = sub(cyclic(input, s + 1), add(a, b, c));
			const nPoints = uniformSpace ? nSegments / n : lengths[s] * nSegments / totalLength;
			for (let i = 0; i < nPoints; i++) {
				const t = i / nPoints;
				vertices.push(add(a, mul(b, t), mul(c, t * t), mul(d, t * t * t)));
			}
		}
		return vertices;
	}
	else if (method == 'bspline') {
		if (vertexArray.length < 2)
			return [];
		const degree = 3;
		const n = vertexArray.length;
		const f = t => deBoor(degree, degree, Math.trunc(t), t, vertexArray, closed);
		// const f = t => deBoorHalf(degree, Math.trunc(t), t % 1, vertexArray, closed);
		const vertices = [];
		for (let i = 0; i < nSegments; i++) {
			if (closed)
				vertices.push(f(lerp(0, n, i / nSegments)));
			else
				vertices.push(f(lerp(0, n + degree, i / nSegments)));
		}
		return vertices;
	} else {
		alert(`Unknown spline method: ${method}`);
	}
}
function drawAnnotations({ previewNextVertex = false, completePath = false, shouldCommit = false }) {
	removeQueue.forEach((x) => scene.remove(x));

	let vertexArray;
	let normalArray;

	if (screenspaceProjection) {
		vertexArray = [...gVertexArray];
		if (previewNextVertex && expectedNextVertex) {
			vertexArray.push(expectedNextVertex);
		}
	} else {
		vertexArray = gVertexArray.map(x => x.point);
		normalArray = gVertexArray.map(x => x.normal);
		if (previewNextVertex && expectedNextVertex) {
			vertexArray.push(expectedNextVertex.point);
			normalArray.push(expectedNextVertex.normal);
		}
	}

	const annotations = []

	if (shape == 'rectangle') {
		if ((!previewNextVertex && vertexArray.length == 2) || (previewNextVertex && vertexArray.length == 3))
			shouldCommit = true;
		for (let i = 0; i < Math.trunc(vertexArray.length / 2); i++) {
			console.assert(i * 2 + 1 < vertexArray.length);
			let p0 = vertexArray[i * 2].clone();
			let p1 = vertexArray[i * 2 + 1].clone();
			if (centerMode)
				p0 = sub(mul(p0, 2), p1);
			const pc = lerp(p0, p1, 0.5);

			let vertices;
			let length = 0;
			let area = 0;
			if (screenspaceProjection) {
				vertices = buildRectangleVertices(new THREE.Vector2(1, 0), p0, p1, width / height);
				vertices = projectRectangle(vertices, cameraRayIntersection);
				length = pathLength(vertices);
				area = polygonArea(vertices, x => x.clone().applyMatrix4(camera.matrixWorldInverse));
			} else {
				const p = pc
				const n = add(normalArray[i * 2], normalArray[i * 2 + 1], new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion)).normalize()
				const [toLocal, toWorld, axis, pA, pC] = buildPlanarSystem(p, n, p0, p1);
				vertices = buildRectangleVertices(axis, pA, pC, width / height);
				if (projectionMethod == 'normal')
					vertices = projectRectangle(vertices, coord => {
						const worldPos = add(toWorld(coord), mul(n, 100));
						raycaster.set(worldPos, neg(n));
						return arrayToOptional(raycaster.intersectObject(mesh, false));
					});
				else if (projectionMethod == 'distance')
					vertices = projectRectangle(vertices, coord => closestPoint(toWorld(coord)));
				length = pathLength(vertices);
				area = polygonArea(vertices);
			}
			annotations.push(createPath(vertices));

			if (vertices && vertices.length > 0) {
				if (i >= activeLabels.length) {
					createLabel(i, vertices[0]);
				}
				activeLabels[i].textContent = `length: ${length.toFixed(2)}\narea: ${area.toFixed(2)}`;
			}
		}
	} else if (shape == 'circle') {
		if ((!previewNextVertex && vertexArray.length == 2) || (previewNextVertex && vertexArray.length == 3))
			shouldCommit = true;
		for (let i = 0; i < Math.trunc(vertexArray.length / 2); i++) {
			let p0 = vertexArray[i * 2].clone();
			let p1 = vertexArray[i * 2 + 1].clone();
			if (centerMode)
				p0 = sub(mul(p0, 2), p1);
			const pc = lerp(p0, p1, 0.5);
			let area = 0;

			let vertices;
			if (screenspaceProjection) {
				vertices = projectCircle(p0, p1, width / height, cameraRayIntersection);
				area = polygonArea(vertices, x => x.clone().applyMatrix4(camera.matrixWorldInverse));
			} else {
				const { point: p, normal: n } = centerMode ? { point: vertexArray[i * 2], normal: normalArray[i * 2] } : closestPoint(pc);
				const [toLocal, toWorld, axis, pA, pC] = buildPlanarSystem(p, n, p0, p1);
				if (projectionMethod == 'normal')
					vertices = projectCircle(pA, pC, 1, coord => {
						const worldPos = add(toWorld(coord), proj(n, sub(camera.position, p)));
						raycaster.set(worldPos, neg(n));
						return arrayToOptional(raycaster.intersectObject(mesh, false));
					});
				else if (projectionMethod == 'distance')
					vertices = projectCircle(pA, pC, 1, coord => closestPoint(toWorld(coord)));
				area = polygonArea(vertices);
			}
			annotations.push(createPath(vertices));

			if (vertices && vertices.length > 0) {
				if (i >= activeLabels.length)
					createLabel(i, vertices[0]);
				activeLabels[i].textContent = `length: ${pathLength(vertices).toFixed(2)}\narea: ${area.toFixed(2)}`;
			}
		}
	} else if (shape == 'polygon') {
		let vertices = [];

		for (let i = 0; i < (completePath ? vertexArray.length : vertexArray.length - 1); i++) {
			let p0 = vertexArray[i].clone();
			let p1 = vertexArray[(i + 1) % vertexArray.length].clone();

			let segment = screenspaceProjection ? projectLineSegment(p0, p1, cameraRayIntersection) : projectLineSegment(p0, p1, closestPoint);
			vertices.push(...segment);

			if (segment.length > 0) {
				if (i >= activeLabels.length)
					createLabel(i, segment[0]);
				activeLabels[i].textContent = `length: ${pathLength(segment).toFixed(2)}`;
			}
		}
		annotations.push(createPath(vertices));
		if (activeLabels.length > 0)
			activeLabels[0].textContent += `\narea: ${polygonArea(vertices).toFixed(2)}`;

	} else if (['catmull-rom', 'cubic', 'bspline'].includes(shape)) {
		if (vertexArray.length > 1) {
			if (screenspaceProjection)
				vertexArray = vertexArray.map(v => new THREE.Vector3(v.x, v.y, 0));
			let totalLength = 0;
			for (let i = 0; i < vertexArray.length - 1; i++)
				totalLength += sub(vertexArray[i], vertexArray[i + 1]).length();
			if (closed)
				totalLength += sub(vertexArray[0], cyclic(vertexArray, -1)).length();
			const nSegments = segmentDensity * totalLength;
			console.log(nSegments);
			if (nSegments == 0)
				return [];
			let vertices = [];
			if (screenspaceProjection) {
				vertices = createSpline(shape, vertexArray, nSegments, completePath, false);
				vertices = vertices.map(p => {
					const projection = cameraRayIntersection(new THREE.Vector2(p.x, p.y));
					if (projection)
						return add(projection.point, mul(projection.normal, epsilon));
					else
						return null;
				}).filter(p => p);
			}
			else {
				vertices = createSpline(shape, vertexArray, Math.pow(nSegments, 2 / 3), completePath, false);
				vertices = vertices.map(p => {
					const projection = closestPoint(p);
					return add(projection.point, mul(projection.normal, epsilon));
				});
				vertices = createSpline(shape, vertices, nSegments, completePath, true);
			}
			annotations.push(createPath(vertices));

			if (vertices && vertices.length > 0) {
				if (0 >= activeLabels.length)
					createLabel(0, vertices[0]);
				activeLabels[0].textContent = `length: ${pathLength(vertices).toFixed(2)}\narea: ${polygonArea(vertices).toFixed(2)}`;
			}
		}
	} else {
		alert(`Unknown draw shape ${shape}`);
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
		scene.remove(expectedVertexPointMesh);
		drawAnnotations({ completePath: true, shouldCommit: true, previewNextVertex: false }).forEach((x) => scene.add(x));
	} if (e.key == 'Escape') {
		scene.remove(expectedVertexPointMesh);
		if (gVertexArray.length == 1) {
			activeLabels.forEach(x => x.remove());
		}
		drawAnnotations({ completePath: false, shouldCommit: true, previewNextVertex: false }).forEach((x) => scene.add(x));
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