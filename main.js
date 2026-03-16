import * as THREE from 'three';
import { Vector2, Vector3 } from 'three';
import { OrbitControls, GLTFLoader, BufferGeometryUtils, FullScreenQuad } from 'three/examples/jsm/Addons.js'
import {
	computeBoundsTree, disposeBoundsTree, acceleratedRaycast,
	MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture,
	BVHShaderGLSL,
} from 'three-mesh-bvh';

const { mergeGeometries } = BufferGeometryUtils

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
			? new Vector3(0, 1, 0)
			: new Vector3(1, 0, 0);

	const x = new Vector3().crossVectors(up, n).normalize();

	const y = new Vector3().crossVectors(n, x).normalize();

	return [x, y, n.clone()]
}
function sampleDisk(u0, u1) {
	const r = Math.sqrt(u0)
	const theta = u1 * Math.PI * 2
	return new Vector2(r * Math.cos(theta), r * Math.sin(theta))
}
function sampleHemisphere(z, u1) {
	const theta = u1 * Math.PI * 2
	const base = Math.sqrt(1 - z * z)
	return new Vector3(base * Math.cos(theta), z, base * Math.sin(theta))
}
function sampleCosineWeightedHemisphere(u0, u1) {
	const r = Math.sqrt(u0)
	const theta = u1 * Math.PI * 2
	return new Vector3(r * Math.cos(theta), Math.sqrt(1 - r * r), r * Math.sin(theta))
}

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

let width = window.innerWidth;
let height = window.innerHeight;
let aspect = width / height;
const dpr = window.devicePixelRatio;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 100);
camera.position.set(0, 0, 1);

const geometry = await (async (name) => {
	if (name == 'knot')
		return new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
	if (name == 'torus')
		return new THREE.TorusGeometry(2, 1, 32)
	if (name == 'capsule')
		return new THREE.CapsuleGeometry(1, 1, 30, 40, 1);

	const loader = new GLTFLoader();
	const gltf = await loader.loadAsync(`/public/${name}.glb`);
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
	);
})('melody-rotated');
geometry.computeBoundingSphere()
const scaleFactor = 1 / geometry.boundingSphere.radius
geometry.scale(scaleFactor, scaleFactor, scaleFactor)
geometry.computeVertexNormals()
geometry.computeBoundsTree();
const material = new THREE.MeshStandardMaterial();
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight)

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(dpr)
renderer.setSize(width, height);
renderer.setAnimationLoop((time) => {
	renderer.render(scene, camera);
});
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);

let cosineWeighted = false

// const computeAO = (p) => {
// 	const nsamples = 100
// 	let hits = 0

// 	for (let i = 0; i < nsamples; i++) {
// 		const w = (cosineWeighted ? sampleCosineWeightedHemisphere : sampleHemisphere)(Math.random(), Math.random())
// 		raycaster.set(p, w)
// 		if (raycaster.intersectObject(mesh, false).length > 0)
// 			hits++
// 	}

// 	return hits / nsamples
// }
// const bakeAO = () => {
// 	for (let y = 0; y < aoTextureHeight; y++) {
// 		for (let x = 0; x < aoTextureWidth; x++) {
// 			const i = (y * aoTextureWidth + x) * 4
// 			const p = position.clone()
// 			p.x += (x / aoTextureWidth - 0.5) * size.x
// 			p.z += (y / aoTextureHeight - 0.5) * size.y
// 			const ao = computeAO(p)
// 			data[i + 0] = 255.99 * (1 - ao)
// 			data[i + 1] = 255.99 * (1 - ao)
// 			data[i + 2] = 255.99 * (1 - ao)
// 			data[i + 3] = 255
// 		}
// 	}
// }

const bbox = mesh.geometry.boundingBox
const position = new Vector3((bbox.min.x + bbox.max.x) / 2, bbox.min.y, (bbox.min.z + bbox.max.z) / 2)
const max_extend = Math.max(bbox.max.x - bbox.min.x, bbox.max.z - bbox.min.z)
const size = new Vector2(max_extend * 3, max_extend * 3)

const aoTextureWidth = 128
const aoTextureHeight = 128
// const data = new Uint8Array(4 * aoTextureWidth * aoTextureHeight)
// bakeAO()

const rtMaterial = new THREE.ShaderMaterial({
	defines: {
	},
	uniforms: {
		bvh: { value: new MeshBVHUniformStruct() },
		position: { value: position },
		size: { value: size }
	},
	vertexShader: `
			varying vec2 vUv;
			void main() {
				gl_Position = vec4(position, 1);
				vUv = uv;
			}
		`,

	fragmentShader: `
			${BVHShaderGLSL.common_functions}
			${BVHShaderGLSL.bvh_struct_definitions}
			${BVHShaderGLSL.bvh_ray_functions}
			uniform BVH bvh;
			uniform vec3 position;
			uniform vec2 size;
			varying vec2 vUv;

			const float PI = 3.14159216;
			vec3 sampleCosineHemisphere(float u0, float u1) {
				float r =sqrt(u0);
				float theta = u1 * PI * 2.;
				return vec3(r * cos(theta), sqrt(1. - r * r), r * sin(theta));
			}
	
			uvec3 pcg3d(uvec3 v) {
				v = v * 1664525u + 1013904223u;
				v.x += v.y*v.z;
				v.y += v.z*v.x;
				v.z += v.x*v.y;
				v = v ^ (v>>16u);
				v.x += v.y*v.z;
				v.y += v.z*v.x;
				v.z += v.x*v.y;
				return v;
			}


			void main() {
			vec3 p = position;
			p.x += (vUv.x - 0.5) * size.x;
			p.z += (vUv.y - 0.5) * size.y;

			uvec4 faceIndices = uvec4( 0u );
			vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
			vec3 barycoord = vec3( 0.0 );
			float side = 1.0;
			float dist = 0.0;

			const int nsamples_sqrt = 30;
			const int nsamples = nsamples_sqrt * nsamples_sqrt;
			int hits = 0;
			for(int i = 0; i < nsamples; i++) {
			uvec3 u = pcg3d(uvec3(gl_FragCoord.x, gl_FragCoord.y, i));
			float u0 = (float(i % nsamples_sqrt) + float(u.x) / 4294967296.) / float(nsamples_sqrt);
			float u1 = (float(i / nsamples_sqrt) + float(u.y) / 4294967296.) / float(nsamples_sqrt);
				if(bvhIntersectFirstHit( bvh, p, sampleCosineHemisphere(u0, u1), faceIndices, faceNormal, barycoord, side, dist ))
					hits += 1;
			}

			float ao = 1. - float(hits) / float(nsamples);
			gl_FragColor = vec4(ao, ao, ao, 1);
			}
		`

});
const renderTarget = new THREE.WebGLRenderTarget(aoTextureWidth, aoTextureWidth, {
	depthBuffer: false,
	stencilBuffer: false
});
renderTarget.texture.magFilter = THREE.LinearFilter
renderTarget.texture.colorSpace = THREE.LinearSRGBColorSpace
const rtQuad = new FullScreenQuad(rtMaterial);
rtMaterial.uniforms.bvh.value.updateFrom(geometry.boundsTree);

const t0 = performance.now();
renderer.setRenderTarget(renderTarget)
rtQuad.render(renderer)
renderer.setRenderTarget(null)
const t1 = performance.now();

console.log('AO computed in:', t1 - t0, 'ms');

const plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), new THREE.MeshBasicMaterial({
	map: renderTarget.texture,
	side: THREE.DoubleSide
}))
plane.rotateX(Math.PI / 2)
plane.position.copy(position)
scene.add(plane)

document.getElementById('cosineWeighted').addEventListener('pointerdown', () => {
	cosineWeighted = !cosineWeighted
	document.getElementById('cosineWeighted').classList.toggle('pressed', cosineWeighted)
	bakeAO()
	texture.needsUpdate = true
})