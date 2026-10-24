// Đọc portfolio.js / calculated.js (vốn viết cho trình duyệt: `window.X = {...}`) từ Node.
const fs = require('node:fs');
const path = require('node:path');
const F = require('../core.js');

const ROOT = path.join(__dirname, '..');
const PORTFOLIO_FILE = path.join(ROOT, 'portfolio.js');
const CALC_FILE = path.join(ROOT, 'calculated.js');

function readWindowFile(file, key) {
  const obj = F.evalCalculated(fs.readFileSync(file, 'utf8'), key);
  if (!obj) throw new Error(`${path.basename(file)} không gán window.${key}`);
  return obj;
}

const readPortfolio = () => readWindowFile(PORTFOLIO_FILE, 'PORTFOLIO');
const readCalculated = () => readWindowFile(CALC_FILE, 'CALCULATED');
const loadState = () => F.merge(readPortfolio(), readCalculated());

module.exports = { ROOT, PORTFOLIO_FILE, CALC_FILE, readPortfolio, readCalculated, loadState };
