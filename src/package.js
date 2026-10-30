// 공개 fixture 꾸러미를 읽고 asset-manifest.json 의 SHA-256 과 파일 바이트를 대조한다.
export const PKG_DIR = 'assets/t04-real-information-board-public-v1/';

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadPackage() {
  const manifest = await (await fetch(PKG_DIR + 'asset-manifest.json', { cache: 'no-store' })).json();
  const checks = await Promise.all(manifest.files.map(async (f) => {
    try {
      const buf = await (await fetch(PKG_DIR + f.path, { cache: 'no-store' })).arrayBuffer();
      const got = await sha256Hex(buf);
      return { path: f.path, bytes: buf.byteLength, want: f.sha256, got, ok: got === f.sha256 && buf.byteLength === f.bytes, buf };
    } catch (e) { return { path: f.path, ok: false, got: String(e.message) }; }
  }));
  const text = (p) => new TextDecoder().decode(checks.find((c) => c.path === p).buf);
  const contract = JSON.parse(text('public-contract.json'));
  const fixtures = {};
  for (const p of contract.fixture_contract.fixture_files) {
    const fx = JSON.parse(text(p));
    fixtures[fx.fixture_id] = fx;
  }
  return {
    package_id: manifest.package_id,
    contract_package_id: contract.package_id,
    contract_version: contract.contract_version,
    fixture_contract_version: contract.fixture_contract.version,
    checks: checks.map(({ buf, ...c }) => c),
    allOk: checks.every((c) => c.ok) && manifest.package_id === contract.package_id,
    contract,
    fixtures,
  };
}
