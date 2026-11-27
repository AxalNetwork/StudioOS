const fs = require('fs');
const html = fs.readFileSync('spin-out-lab-pipeline/workspace-reference.html', 'utf-8');

const getSection = (name) => {
  const lines = html.split('\n');
  let inSection = false;
  let res = [];
  for (const line of lines) {
    if (line.includes(`<!-- ${name} `)) inSection = true;
    if (inSection) res.push(line);
    if (inSection && line.includes('</section>')) break;
  }
  return res.join('\n');
};

console.log('SECTION 1:\n', getSection('SECTION 1'));
console.log('SECTION 2A:\n', getSection('SECTION 2A'));
console.log('SECTION 2:\n', getSection('SECTION 2'));
console.log('SECTION 3:\n', getSection('SECTION 3'));
console.log('SECTION 4:\n', getSection('SECTION 4'));
console.log('PAGE HEADER:\n', getSection('PAGE HEADER'));
