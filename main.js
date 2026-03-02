import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
	computeBoundsTree, disposeBoundsTree,
	acceleratedRaycast,
	getTriangleHitPointInfo
} from 'three-mesh-bvh';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const { Vector2, Vector3 } = THREE;

/*
	Helpers
*/
function add(a, b, ...args) {
	let result = a.clone().add(b);
	for (const x of args)
		result.add(x);
	return result;
}
function dot(a, b) {
	return a.dot(b);
}
function cross(a, b) {
	return a.clone().cross(b);
}
function normalize(a) {
	return a.clone().normalize();
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
function projOnVector(v, x) {
	return mul(v, v.dot(x));
}
function projOnPlane(n, x) {
	return sub(x, projOnVector(x, n))
}
function lerp(x, y, t) {
	if (typeof x === 'number' && typeof y === 'number')
		return (1 - t) * x + t * y;
	else
		return x.clone().lerp(y, t);
}
function barycentric(b, x, y, z) {
	return add(mul(x, b.x), mul(y, b.y), mul(z, b.z))
}
function coordinateSystem(n, up) {
	if (up === undefined)
		up = Math.abs(n.y) < 0.9
			? new Vector3(0, 1, 0)
			: new Vector3(1, 0, 0);

	const x = new Vector3().crossVectors(up, n).normalize();

	const y = new Vector3().crossVectors(n, x).normalize();

	return [x, y, n.clone()]
}
async function sampleGeo(name, scale) {
	if (name == 'sphere')
		return new THREE.SphereGeometry(1, 16, 16);
	if (name == 'knot')
		return new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
	if (name == 'torus')
		return new THREE.TorusGeometry(2, 1, 32)
	if (name == 'capsule')
		return new THREE.CapsuleGeometry(1, 1, 30, 40, 1);

	if (scale == null) scale = 1.0
	const gltf = await new GLTFLoader().loadAsync(`/public/${name}.glb`);
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
	).scale(scale, scale, scale);
}

/*
	Settings
*/
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

let width = window.innerWidth;
let height = window.innerHeight;
let aspect = width / height;
const dpr = window.devicePixelRatio;
window.addEventListener('resize', onWindowResize);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, width / height, 0.001, 100);
camera.position.set(0, 0, 5);

let geometry = await sampleGeo('bunny');
geometry.center()
geometry.computeBoundingSphere()
const scaleFactor = 1 / geometry.boundingSphere.radius;
geometry.scale(scaleFactor, scaleFactor, scaleFactor);
geometry.computeBoundsTree();
geometry.computeVertexNormals()
let baseGeometry = new THREE.BufferGeometry()
baseGeometry.setIndex(geometry.getIndex())
baseGeometry.setAttribute('position', geometry.getAttribute('position'))
const merged = mergeVertices(baseGeometry, 1e-5);
baseGeometry.dispose();
baseGeometry = merged;
baseGeometry.computeVertexNormals()
const p = baseGeometry.attributes['position'].array
const v = []
for (let i = 0; i < p.length; i += 3)
	v.push(new Vector(p[i], p[i + 1], p[i + 2]))
const polygonSoup = { v, f: [...baseGeometry.index.array] }
const gpMesh = new Mesh()
console.assert(gpMesh.build(polygonSoup))
const gpGeometry = new Geometry(gpMesh, polygonSoup.v, false)
const material = new THREE.MeshNormalMaterial({ polygonOffset: true, polygonOffsetUnits: 1, polygonOffsetFactor: 1 });
const mesh = new THREE.Mesh(geometry, material);
const baseMesh = new THREE.Mesh(baseGeometry, material);
scene.add(mesh);
scene.add(new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x000000 })))

const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(dpr)
renderer.setSize(width, height);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true

let shape = "rectangle"
const epsilon = 0.01;
const segmentDensity = 100;

/*
	Algorithms
*/
function closestPoint(p) {
	const target = mesh.geometry.boundsTree.closestPointToPoint(p);
	return { point: target.point, normal: getTriangleHitPointInfo(target.point, mesh.geometry, target.faceIndex).face.normal };

}
function cameraRayIntersection(coord) {
	raycaster.setFromCamera(coord, camera);
	const intersects = raycaster.intersectObject(baseMesh, false);
	if (intersects.length > 0)
		return intersects[0];
	else
		return null;
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
	if (intersection == null)
		return
	intersection.ndc = coord
	gVertexArray.push(intersection);

	const geometry = new THREE.SphereGeometry(0.003, 8, 8);
	const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.copy(intersection.point);
	scene.add(mesh);
}
function createPath(points) {
	const geometry = new LineGeometry();
	if (points.length > 0)
		geometry.setFromPoints(points);
	return new Line2(geometry, new LineMaterial({ linewidth: 4, vertexColors: true }));
}

renderer.domElement.addEventListener('pointerdown', (e) => {
	if (!controls.enabled) {
		let coord = new Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
		addVertex(coord);
		removeQueue.forEach((x) => scene.remove(x));
		drawAnnotations({});
	}

	released = false;
	moved = false;
});
renderer.domElement.addEventListener('pointerup', (e) => {
	if ((controls.enabled && !moved) || (!controls.enabled && moved)) {
		let coord = new Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
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
	const coord = new Vector2((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);

	const intersection = cameraRayIntersection(coord);
	if (intersection == null)
		return
	intersection.ndc = coord
	expectedNextVertex = intersection;

	scene.remove(expectedVertexPointMesh);
	const geometry = new THREE.SphereGeometry(0.003, 8, 8);
	const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	expectedVertexPointMesh = new THREE.Mesh(geometry, material);
	expectedVertexPointMesh.position.copy(intersection.point);
	scene.add(expectedVertexPointMesh);

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
	const det = 1 / (a * d - b * c);
	return [add(mul(b0, d * det), mul(b1, -b * det))
		, add(mul(b0, -c * det), mul(b1, a * det))];
}
function solveScalar(a, b, c, d, b0, b1) {
	const det = 1 / (a * d - b * c);
	return [b0 * d * det + b1 * -b * det,
	b0 * -c * det + b1 * a * det];
}
function to3(v) {
	return new Vector3(v.x, v.y, v.z)
}
// Project x onto v and w
function proj2(x, v, w) {
	return solveScalar(dot(v, v), dot(v, w), dot(v, w), dot(w, w), dot(x, v), dot(x, w))
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

function createSpline(method, vertexArray, nSegments, closed, uniformSpace) {
	if (method == 'cubic') {
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
function vertexPos(index) {
	return to3(gpGeometry.positions[gpGeometry.mesh.vertices[index]])
}
function sliceGeometry(vertices, source, cutN, forwardDir, { stopOnFace, stopOnLength }, dest) {
	let currentLength = 0

	let halfedge = gpGeometry.mesh.faces[source.faceIndex].halfedge
	const v0 = gpGeometry.mesh.vertices[source.face.a]
	const v1 = gpGeometry.mesh.vertices[source.face.b]
	const v2 = gpGeometry.mesh.vertices[source.face.c]
	let p = new Vector2(0, 0)
	const fvs = [halfedge.vertex, halfedge.next.vertex, halfedge.prev.vertex]
	for (let i = 0; i < 3; i++)
		if (fvs[i] == v0 && fvs[(i + 1) % 3] == v1 && fvs[(i + 2) % 3] == v2) {
			p.x = source.barycoord.getComponent((5 - i) % 3)
			p.y = source.barycoord.getComponent((4 - i) % 3)
		}
	const firstFaceIndex = halfedge.face.index
	if (stopOnFace != null && halfedge.face.index == stopOnFace)
		return vertices

	let dir = normalize(cross(to3(gpGeometry.faceNormal(halfedge.face)), cutN))
	if (dot(dir, forwardDir) < 0)
		dir = neg(dir)
	const u = gpGeometry.vector(halfedge.prev).negated()
	const v = gpGeometry.vector(halfedge)
	const [dx, dy] = proj2(dir, u, v)
	const edges = [
		{ edge: halfedge, p0: new Vector2(0, 0), p1: new Vector2(0, 1) },
		{ edge: halfedge.next, p0: new Vector2(0, 1), p1: new Vector2(1, 0) },
		{ edge: halfedge.prev, p0: new Vector2(1, 0), p1: new Vector2(0, 0) }]
	let next_py = 0
	for (const { edge, p0, p1 } of edges) {
		const [t, k] = solveScalar(dx, p0.x - p1.x, dy, p0.y - p1.y, p0.x - p.x, p0.y - p.y)
		if (t > 0 && k >= 0 && k <= 1) {
			vertices.push(lerp(to3(gpGeometry.positions[edge.vertex]), to3(gpGeometry.positions[edge.next.vertex]), k))
			currentLength += cyclic(vertices, -1).distanceTo(cyclic(vertices, -2))
			next_py = 1 - k
			halfedge = edge.twin
		}
	}
	p.x = 0
	p.y = next_py

	while (true) {
		if (stopOnFace != null && halfedge.face.index == stopOnFace || halfedge.face.index == firstFaceIndex)
			break
		if (stopOnLength != null && currentLength > stopOnLength)
			break
		const dir = normalize(cross(to3(gpGeometry.faceNormal(halfedge.face)), cutN))
		const u = gpGeometry.vector(halfedge.prev).negated()
		const v = gpGeometry.vector(halfedge)
		const [dx, dy] = proj2(dir, u, v)
		const edges = [
			{ edge: halfedge.next, p0: new Vector2(0, 1), p1: new Vector2(1, 0) },
			{ edge: halfedge.prev, p0: new Vector2(1, 0), p1: new Vector2(0, 0) }]
		let next_py = 0
		for (const { edge, p0, p1 } of edges) {
			const [t, k] = solveScalar(dx, p0.x - p1.x, dy, p0.y - p1.y, p0.x - p.x, p0.y - p.y)
			if (k >= 0 && k <= 1) {
				vertices.push(lerp(to3(gpGeometry.positions[edge.vertex]), to3(gpGeometry.positions[edge.next.vertex]), k))
				next_py = 1 - k
				halfedge = edge.twin
			}
		}
		p.y = next_py
		currentLength += cyclic(vertices, -1).distanceTo(cyclic(vertices, -2))
	}
	if (stopOnLength) {
		console.assert(vertices.length >= 2)
		const lastSegmentLength = cyclic(vertices, -1).distanceTo(cyclic(vertices, -2))
		const k = 1 - (currentLength - stopOnLength) / lastSegmentLength
		vertices[vertices.length - 1] = lerp(cyclic(vertices, -2), cyclic(vertices, -1), k)
		halfedge = halfedge.twin
		dest.faceIndex = halfedge.face.index
		dest.face = { a: halfedge.vertex.index, b: halfedge.next.vertex.index, c: halfedge.prev.vertex.index }
		const [u, v] = proj2(sub(cyclic(vertices, -1), vertexPos(dest.face.a)), gpGeometry.vector(halfedge), gpGeometry.vector(halfedge.prev).negated())
		dest.barycoord = new Vector3(1 - u - v, u, v)
	}

	return vertices
}
function drawAnnotations({ previewNextVertex = false, completePath = false, shouldCommit = false }) {
	removeQueue.forEach((x) => scene.remove(x));

	const vertexArray = [...gVertexArray];
	if (previewNextVertex && expectedNextVertex)
		vertexArray.push(expectedNextVertex);

	const annotations = []

	if (shape == 'rectangle') {
		if (gVertexArray.length == 2)
			shouldCommit = true;
		for (let i = 0; i < Math.trunc(vertexArray.length / 2); i++) {
			const vertices = []
			const va = vertexArray[i * 2]
			const vb = vertexArray[i * 2 + 1]
			const dest = {}
			{
				vertices.push(barycentric(va.barycoord, vertexPos(va.face.a), vertexPos(va.face.b), vertexPos(va.face.c)))
				const cutN = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
				const targetLength = projOnVector(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion), sub(vb.point, va.point)).length()
				sliceGeometry(vertices, va, cutN, projOnPlane(cutN, sub(vb.point, va.point)), { stopOnLength: targetLength }, dest)
			}
			{
				const p = cyclic(vertices, -1)
				const cutN = normalize(cross(sub(vb.point, p), new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)))
				sliceGeometry(vertices, dest, cutN, projOnPlane(cutN, sub(vb.point, p)), { stopOnFace: vb.faceIndex })
				vertices.push(barycentric(vb.barycoord, vertexPos(vb.face.a), vertexPos(vb.face.b), vertexPos(vb.face.c)))
			}
			{
				const cutN = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
				const targetLength = projOnVector(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion), sub(vb.point, va.point)).length()
				sliceGeometry(vertices, vb, cutN, projOnPlane(cutN, sub(va.point, vb.point)), { stopOnLength: targetLength }, dest)
			}
			{
				const p = cyclic(vertices, -1)
				const cutN = normalize(cross(sub(va.point, p), new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)))
				sliceGeometry(vertices, dest, cutN, projOnPlane(cutN, sub(va.point, p)), { stopOnFace: va.faceIndex })
				vertices.push(barycentric(va.barycoord, vertexPos(va.face.a), vertexPos(va.face.b), vertexPos(va.face.c)))
			}
			annotations.push(createPath(vertices));
		}

	} else if (shape == 'circle') {
		if (gVertexArray.length == 2)
			shouldCommit = true;
		for (let i = 0; i < Math.trunc(vertexArray.length / 2); i++) {
			let p0 = vertexArray[i * 2].clone();
			let p1 = vertexArray[i * 2 + 1].clone();
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
						const worldPos = add(toWorld(coord), projOnVector(n, sub(camera.position, p)));
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
				vertexArray = vertexArray.map(v => new Vector3(v.x, v.y, 0));
			let totalLength = 0;
			for (let i = 0; i < vertexArray.length - 1; i++)
				totalLength += sub(vertexArray[i], vertexArray[i + 1]).length();
			if (closed)
				totalLength += sub(vertexArray[0], cyclic(vertexArray, -1)).length();
			const nSegments = segmentDensity * totalLength;
			if (nSegments == 0)
				return [];
			let vertices = [];
			if (screenspaceProjection) {
				vertices = createSpline(shape, vertexArray, nSegments, completePath, false);
				vertices = vertices.map(p => {
					const projection = cameraRayIntersection(new Vector2(p.x, p.y));
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

document.getElementById('draw-shape').addEventListener('change', e => {
	shape = e.target.value;
	commitAnnotations();
});
document.getElementById("draw-shape").value = shape

window.addEventListener('keydown', (e) => {
	if (e.key == 'Enter') {
		scene.remove(expectedVertexPointMesh);
		drawAnnotations({ completePath: true, shouldCommit: true, previewNextVertex: false });
	} if (e.key == 'Escape') {
		scene.remove(expectedVertexPointMesh);
		if (gVertexArray.length == 1) {
			activeLabels.forEach(x => x.remove());
		}
		drawAnnotations({ completePath: false, shouldCommit: true, previewNextVertex: false });
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