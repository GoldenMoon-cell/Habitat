import fs from "node:fs";
const src = fs.readFileSync("src/data/personas.ts", "utf8");

const orderMatch = src.match(/AXIS_ORDER = \[([^\]]+)\]/);
const AXES = orderMatch[1].split(",").map(s => s.trim().replace(/"/g, "")).filter(Boolean);

const people = [];
const re = /name: "([^"]+)"[\s\S]{0,2500}?axes: \{([^}]+)\}/g;
let m;
while ((m = re.exec(src))) {
  const name = m[1];
  const obj = {};
  m[2].split(",").forEach(pair => {
    const [k, v] = pair.split(":").map(s => s.trim());
    if (k && v) obj[k.replace(/"/g, "")] = Number(v);
  });
  const vals = AXES.map(a => obj[a]).filter(v => typeof v === "number" && !isNaN(v));
  if (vals.length === AXES.length) people.push({ name, axes: obj });
}

console.log(`解析到 ${people.length} 个角色\n`);
if (people.length === 0) { console.log("没解析到，看下 personas.ts 的写法"); process.exit(0); }

console.log("=== 每个轴的区分度（标准差越大越有信息）===");
AXES.forEach(a => {
  const vs = people.map(p => p.axes[a]);
  const mean = vs.reduce((s, v) => s + v, 0) / vs.length;
  const sd = Math.sqrt(vs.reduce((s, v) => s + (v - mean) ** 2, 0) / vs.length);
  const min = Math.min(...vs), max = Math.max(...vs);
  const flag = sd < 8 ? "无区分度" : sd < 15 ? "偏窄" : "OK";
  console.log(`  ${a.padEnd(4)} 均值 ${String(mean.toFixed(0)).padStart(3)}  标准差 ${sd.toFixed(1).padStart(5)}  范围 ${min}-${max}  ${flag}`);
});

console.log("\n=== 轴之间的相关性（|r|>0.7 可能是同一个轴）===");
const corr = (a, b) => {
  const xa = people.map(p => p.axes[a]), xb = people.map(p => p.axes[b]);
  const ma = xa.reduce((s, v) => s + v, 0) / xa.length;
  const mb = xb.reduce((s, v) => s + v, 0) / xb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < xa.length; i++) {
    num += (xa[i] - ma) * (xb[i] - mb);
    da += (xa[i] - ma) ** 2;
    db += (xb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
};

const pairs = [];
for (let i = 0; i < AXES.length; i++)
  for (let j = i + 1; j < AXES.length; j++)
    pairs.push({ a: AXES[i], b: AXES[j], r: corr(AXES[i], AXES[j]) });

pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
pairs.forEach(p => {
  const flag = Math.abs(p.r) > 0.7 ? "高度相关" : Math.abs(p.r) > 0.5 ? "中等" : "独立";
  console.log(`  ${p.a.padEnd(3)} - ${p.b.padEnd(3)}  r = ${p.r.toFixed(2).padStart(6)}  ${flag}`);
});

console.log("\n=== 各角色六维 ===");
console.log("  " + "name".padEnd(10) + AXES.map(a => a.padStart(5)).join(""));
people.forEach(p => {
  console.log("  " + p.name.padEnd(10) + AXES.map(a => String(p.axes[a]).padStart(5)).join(""));
});
