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
function add(a, b, ...args) {
	let result = a.clone().add(b);
	for (const x of args)
		result.add(x);
	return result;
}
function dot(a, b) {
	return a.dot(b);
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

let geometry1 = await sampleGeo('duck');
geometry1.deleteAttribute('normal');
geometry1.deleteAttribute('tangent');
geometry1.deleteAttribute('uv');

const tolerance = 1e-5;
const merged = mergeVertices(geometry1, tolerance);
geometry1.dispose();
geometry1 = merged;

const p = geometry1.attributes['position'].array
const v = []
for (let i = 0; i < p.length; i += 3)
	v.push(new Vector(p[i], p[i + 1], p[i + 2]))
const polygonSoup = { v, f: [...geometry1.index.array] }
const gpMesh = new Mesh()
console.assert(gpMesh.build(polygonSoup))
const gpGeometry = new Geometry(gpMesh, polygonSoup.v, true)

class CachedGeodesicMethod {
	constructor(geometry) {
		this.geometry = geometry
		this.heatMethod = new HeatMethod(geometry)
		this.delta = DenseMatrix.zeros(geometry.mesh.vertices.length, 1);
	}
	computePhi(source) {
		if (source != this.prevSource) {
			this.prevSource = source

			for (let j = 0; j < this.delta.nRows(); j++)
				this.delta.set(0, j, 0);
			const a = this.heatMethod.vertexIndex[this.geometry.mesh.vertices[source.face.a]]
			const b = this.heatMethod.vertexIndex[this.geometry.mesh.vertices[source.face.b]]
			const c = this.heatMethod.vertexIndex[this.geometry.mesh.vertices[source.face.c]]
			this.delta.set(source.barycoord.x, a, 0);
			this.delta.set(source.barycoord.y, b, 0);
			this.delta.set(source.barycoord.z, c, 0);
			this.phi = this.heatMethod.compute(this.delta);
		}
	}
	creatGeodesicCircle(source, ref) {
		this.computePhi(source)
		const distance = this.phi.get(this.heatMethod.vertexIndex[this.geometry.mesh.vertices[ref.face.a]], 0)
		const positions = [];
		for (let f of this.geometry.mesh.faces) {
			const segment = [];

			for (let h of f.adjacentHalfedges()) {
				const v1 = h.vertex;
				const v2 = h.twin.vertex;
				const i = this.heatMethod.vertexIndex[v1];
				const j = this.heatMethod.vertexIndex[v2];
				const d1 = this.phi.get(i, 0);
				const d2 = this.phi.get(j, 0);
				const r = (distance - d1) / (d2 - d1);


				if (0 <= r && r <= 1) {
					let p1 = this.geometry.positions[v1];
					let p2 = this.geometry.positions[v2];
					segment.push(p1.plus(p2.minus(p1).times(r)));
				}
			}

			for (let i = 0; i < segment.length - 1; i++)
				for (let j = i + 1; j < segment.length; j++) {
					const p1 = segment[i];
					const p2 = segment[j];
					positions.push(p1.x);
					positions.push(p1.y);
					positions.push(p1.z);
					positions.push(p2.x);
					positions.push(p2.y);
					positions.push(p2.z);
				}
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
		const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
			color: 0x000000
		}));
		mesh.renderOrder = 1;
		mesh.frustumCulled = false;
		return mesh;
	}
	barycentric(p, a, b, c) {
		if (typeof a == 'number')
			return a * p.x + b * p.y + c * (1 - p.x - p.y)
		const r = a.times(p.x).plus(b.times(p.y).plus(c.times(1 - p.x - p.y)))
		return [r.x, r.y, r.z]
	}
	lerp(t, a, b) {
		const r = a.times(1 - t).plus(b.times(t))
		return [r.x, r.y, r.z]
	}
	creatGeodesicLine1(source, ref) {
		this.computePhi(source)
		const positions = [];
		let v0 = this.geometry.mesh.vertices[ref.face.a]
		let v1 = this.geometry.mesh.vertices[ref.face.b]
		let v2 = this.geometry.mesh.vertices[ref.face.c]
		let V0 = this.geometry.mesh.vertices[source.face.a]
		let V1 = this.geometry.mesh.vertices[source.face.b]
		let V2 = this.geometry.mesh.vertices[source.face.c]
		const setV = new Set([V0, V1, V2])
		let phi0 = this.phi.get(this.heatMethod.vertexIndex[v0], 0)
		let phi1 = this.phi.get(this.heatMethod.vertexIndex[v1], 0)
		let phi2 = this.phi.get(this.heatMethod.vertexIndex[v2], 0)
		positions.push(...this.barycentric(ref.barycoord, this.geometry.positions[v0], this.geometry.positions[v1], this.geometry.positions[v2]))
		let f0 = (phi0 + phi1) / 2
		let f1 = (phi1 + phi2) / 2
		let f2 = (phi0 + phi2) / 2
		let fmin = Math.min(f0, f1, f2)
		let halfedge;
		if (fmin == f0) {
			positions.push(...this.lerp(0.5, this.geometry.positions[v0], this.geometry.positions[v1]))
			for (const edge of v0.adjacentHalfedges()) {
				console.assert(edge.vertex == v0)
				if (edge.next.vertex == v1)
					halfedge = edge.prev.vertex == v2 ? edge : edge.twin
			}
		}
		else if (fmin == f1) {
			positions.push(...this.lerp(0.5, this.geometry.positions[v1], this.geometry.positions[v2]))
			for (const edge of v1.adjacentHalfedges()) {
				console.assert(edge.vertex == v1)
				if (edge.next.vertex == v2)
					halfedge = edge.prev.vertex == v0 ? edge : edge.twin
			}
		}
		else {
			positions.push(...this.lerp(0.5, this.geometry.positions[v0], this.geometry.positions[v2]))
			for (const edge of v2.adjacentHalfedges()) {
				console.assert(edge.vertex == v2)
				if (edge.next.vertex == v0)
					halfedge = edge.prev.vertex == v1 ? edge : edge.twin
			}
		}
		console.assert(halfedge != null)
		halfedge = halfedge.twin

		while (true) {
			let phi0 = this.phi.get(this.heatMethod.vertexIndex[halfedge.vertex], 0)
			let phi1 = this.phi.get(this.heatMethod.vertexIndex[halfedge.next.vertex], 0)
			let phi2 = this.phi.get(this.heatMethod.vertexIndex[halfedge.prev.vertex], 0)
			positions.push(...this.lerp(0.5, this.geometry.positions[halfedge.vertex], this.geometry.positions[halfedge.next.vertex]))
			let f0 = (phi0 + phi1) / 2
			let f1 = (phi1 + phi2) / 2
			let f2 = (phi0 + phi2) / 2
			let fmin = Math.min(f1, f2)
			const setv = new Set([halfedge.vertex, halfedge.next.vertex, halfedge.prev.vertex])
			if (setV.isSubsetOf(setv) && setv.isSubsetOf(setV)) {
				positions.push(...this.barycentric(source.barycoord, this.geometry.positions[V0], this.geometry.positions[V1], this.geometry.positions[V2]))
				break
			}
			if (fmin > f0) {
				// alert(`${fmin} ${f0}`)
				break
			}
			if (f1 < f2) {
				positions.push(...this.lerp(0.5, this.geometry.positions[halfedge.next.vertex], this.geometry.positions[halfedge.prev.vertex]))
				halfedge = halfedge.next.twin
			} else {
				positions.push(...this.lerp(0.5, this.geometry.positions[halfedge.vertex], this.geometry.positions[halfedge.prev.vertex]))
				halfedge = halfedge.prev.twin
			}
		}
		console.log(positions)

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
		const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
			depthTest: false,
			depthWrite: true,
			color: 0xFF0000
		}));
		mesh.renderOrder = 1;
		mesh.frustumCulled = false;
		return mesh;
	}
	creatGeodesicLine(source, ref) {
		this.computePhi(source)
		const positions = [];
		let p = new Vector2(ref.barycoord.z, ref.barycoord.y)
		let halfedge

		{
			let v1 = this.geometry.mesh.vertices[ref.face.a]
			let v2 = this.geometry.mesh.vertices[ref.face.b]
			let v3 = this.geometry.mesh.vertices[ref.face.c]
			const f1 = this.phi.get(this.heatMethod.vertexIndex[v1], 0)
			const f2 = this.phi.get(this.heatMethod.vertexIndex[v2], 0)
			const f3 = this.phi.get(this.heatMethod.vertexIndex[v3], 0)
			const vp1 = this.geometry.positions[v1]
			const vp2 = this.geometry.positions[v2]
			const vp3 = this.geometry.positions[v3]
			positions.push(...this.barycentric(ref.barycoord, vp1, vp2, vp3))
			const l2 = vp1.minus(vp2).norm()
			const l3 = vp1.minus(vp3).norm()
			const cosine = vp1.minus(vp2).unit().dot(vp1.minus(vp3).unit())
			const sine = Math.sqrt(1 - cosine * cosine)
			let d = [f1 - f3, f1 - f2]
			d = solve1(1 * l2, cosine * l3, 0, sine * l3, d[0], d[1])
			d = solve1(1 * l2, cosine * l3, 0, sine * l3, d[0], d[1])
			d = new Vector2(d[0], d[1])
			const edges = [
				{ v0: v1, v1: v2, p0: new Vector2(0, 0), p1: new Vector2(0, 1) },
				{ v0: v2, v1: v3, p0: new Vector2(0, 1), p1: new Vector2(1, 0) },
				{ v0: v3, v1: v1, p0: new Vector2(1, 0), p1: new Vector2(0, 0) }]
			for (const { v0, v1, p0, p1 } of edges) {
				const [t, k] = solve1(d.x, p0.x - p1.x, d.y, p0.y - p1.y, p0.x - p.x, p0.y - p.y)
				if (t >= 0 && k >= 0 && k <= 1) {
					p = new Vector2(0, 1 - k);
					for (const edge of v0.adjacentHalfedges())
						if (edge.next.vertex == v1)
							halfedge = edge.twin
					for (const edge of v1.adjacentHalfedges())
						if (edge.next.vertex == v0)
							halfedge = edge
					break
				}
			}

			if (halfedge == null)
				alert("no halfedge")
			positions.push(...this.lerp(p.y, this.geometry.positions[halfedge.vertex], this.geometry.positions[halfedge.next.vertex]))
		}

		while (true) {
			const v1 = halfedge.vertex
			const v2 = halfedge.next.vertex
			const v3 = halfedge.prev.vertex
			const f1 = this.phi.get(this.heatMethod.vertexIndex[v1], 0)
			const f2 = this.phi.get(this.heatMethod.vertexIndex[v2], 0)
			const f3 = this.phi.get(this.heatMethod.vertexIndex[v3], 0)
			const vp1 = this.geometry.positions[v1]
			const vp2 = this.geometry.positions[v2]
			const vp3 = this.geometry.positions[v3]
			const l2 = vp1.minus(vp2).norm()
			const l3 = vp1.minus(vp3).norm()
			const cosine = vp1.minus(vp2).unit().dot(vp1.minus(vp3).unit())
			const sine = Math.sqrt(1 - cosine * cosine)
			let d = [f1 - f3, f1 - f2]
			d = solve1(1 * l2, cosine * l3, 0, sine * l3, d[0], d[1])
			d = solve1(1 * l2, cosine * l3, 0, sine * l3, d[0], d[1])
			d = new Vector2(d[0], d[1])
			if (d.x < 0)
				break
			const edges = [
				{ edge: halfedge.next, p0: new Vector2(0, 1), p1: new Vector2(1, 0) },
				{ edge: halfedge.prev, p0: new Vector2(1, 0), p1: new Vector2(0, 0) }]
			positions.push(...this.lerp(p.y, vp1, vp2))
			let hit = false
			for (const { edge, p0, p1 } of edges) {
				const [t, k] = solve1(d.x, p0.x - p1.x, d.y, p0.y - p1.y, p0.x - p.x, p0.y - p.y)
				if (t >= 0 && k >= 0 && k <= 1) {
					p = new Vector2(0, 1 - k);
					halfedge = edge.twin;
					hit = true
				}
			}
			if (!hit)
				alert('no hit')
			positions.push(...this.lerp(p.y, this.geometry.positions[halfedge.vertex], this.geometry.positions[halfedge.next.vertex]))
		}
		console.log(positions)

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
		const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
			depthTest: false,
			depthWrite: true,
			color: 0xFF0000
		}));
		mesh.renderOrder = 1;
		mesh.frustumCulled = false;
		return mesh;
	}
}
const geodesicMethod = new CachedGeodesicMethod(gpGeometry)

const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(v.length * 3);
const normals = new Float32Array(v.length * 3);
for (let v of gpMesh.vertices) {
	let i = v.index;
	let position = gpGeometry.positions[v];
	positions[3 * i + 0] = position.x;
	positions[3 * i + 1] = position.y;
	positions[3 * i + 2] = position.z;

	let normal = gpGeometry.vertexNormalEquallyWeighted(v);
	normals[3 * i + 0] = normal.x;
	normals[3 * i + 1] = normal.y;
	normals[3 * i + 2] = normal.z;
}
let F = gpMesh.faces.length;
const indices = new Uint32Array(F * 3);
for (let f of gpMesh.faces) {
	let i = 0;
	for (let v of f.adjacentVertices())
		indices[3 * f.index + i++] = v.index;
}
geometry.setIndex(new THREE.BufferAttribute(indices, 1));
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
geometry.computeBoundsTree();

const material = new THREE.MeshNormalMaterial({ polygonOffset: true, polygonOffsetUnits: 1, polygonOffsetFactor: 1 });
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);
scene.add(new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({
	color: 0x000000,
	linewidth: 0.75
})))

const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);
const box = new THREE.Box3().setFromObject(mesh);
const size = new Vector3();
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
let shape = "polygon"
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
		pB = new Vector2(pA.x + (A - B) / 2, pA.y + (A + B) / 2);
		pD = new Vector2(pA.x + (A + B) / 2, pA.y - (A - B) / 2);
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
		const coord = new Vector2(center.x + rX * Math.cos(t), center.y + rY * Math.sin(t));
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
	const toLocal = (v) => { return new Vector2(v.dot(tbn[0]), v.dot(tbn[1])); };
	const toWorld = (coord) => { return add(p, mul(tbn[0], coord.x), mul(tbn[1], coord.y)); };
	const axis = toLocal(new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)).normalize();
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
		const geometry = new THREE.SphereGeometry(0.003, 8, 8);
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
	if (screenspaceProjection)
		expectedNextVertex = coord;
	else
		expectedNextVertex = intersection;

	if (intersection) {
		scene.remove(expectedVertexPointMesh);
		const geometry = new THREE.SphereGeometry(0.003, 8, 8);
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
	const det = 1 / (a * d - b * c);
	return [add(mul(b0, d * det), mul(b1, -b * det))
		, add(mul(b0, -c * det), mul(b1, a * det))];
}
function solve1(a, b, c, d, b0, b1) {
	let det = a * d - b * c;
	if (det == 0)
		alert("Degenerate case")
	det = 1 / det
	return [b0 * d * det + b1 * -b * det, b0 * -c * det + b1 * a * det];
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

	const vertexArray = [...gVertexArray];
	if (previewNextVertex && expectedNextVertex)
		vertexArray.push(expectedNextVertex);

	const annotations = []

	if (shape == 'rectangle') {
		if (gVertexArray.length == 2)
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
				vertices = buildRectangleVertices(new Vector2(1, 0), p0, p1, width / height);
				vertices = projectRectangle(vertices, cameraRayIntersection);
				length = pathLength(vertices);
				area = polygonArea(vertices, x => x.clone().applyMatrix4(camera.matrixWorldInverse));
			} else {
				const { point: p, normal: n } = centerMode ? { point: vertexArray[i * 2], normal: normalArray[i * 2] } : closestPoint(pc);
				const [toLocal, toWorld, axis, pA, pC] = buildPlanarSystem(p, n, p0, p1);
				vertices = buildRectangleVertices(axis, pA, pC, width / height);
				if (projectionMethod == 'normal')
					vertices = projectRectangle(vertices, coord => {
						const worldPos = add(toWorld(coord), proj(n, sub(camera.position, p)));
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
		if (gVertexArray.length == 2)
			shouldCommit = true;
		for (let i = 0; i < Math.trunc(vertexArray.length / 2); i++) {
			let p0 = vertexArray[i * 2]; vertexArray
			let p1 = vertexArray[i * 2 + 1];
			annotations.push(geodesicMethod.creatGeodesicCircle(p0, p1));
		}
	} else if (shape == 'polygon') {
		for (let i = 0; i < (completePath ? vertexArray.length : vertexArray.length - 1); i++) {
			let p0 = vertexArray[i];
			let p1 = vertexArray[(i + 1) % vertexArray.length];

			// let segment = screenspaceProjection ? projectLineSegment(p0, p1, cameraRayIntersection) : projectLineSegment(p0, p1, closestPoint);
			// vertices.push(...segment);
			annotations.push(geodesicMethod.creatGeodesicLine(p0, p1));
		}
		// annotations.push(createPath(vertices));
		// if (activeLabels.length > 0)
		// 	activeLabels[0].textContent = `\narea: ${polygonArea(vertices).toFixed(2)}`;

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