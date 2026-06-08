const fs = require('fs');
const p = 'src/components/configurator/Configurator.jsx';
let c = fs.readFileSync(p, 'utf8');
c = c.replace('<div className="cdd-intro" style={{ marginBottom: "8px", gap: "2px" }>', '<div className="cdd-intro" style={{ marginBottom: "8px", gap: "2px" }}>');
fs.writeFileSync(p, c);