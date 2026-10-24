// Đọc portfolio.js / calculated.js (vốn viết cho trình duyệt: `window.X = {...}`) từ Node, và gọi git.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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

/**
 * Chạy git trong thư mục project. Thông báo lỗi luôn bằng tiếng Anh (LC_ALL=C) để so khớp được,
 * không bao giờ dừng chờ hỏi mật khẩu, và có giới hạn thời gian để mạng chập chờn không treo lệnh.
 */
function git(...args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20000,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function isGitRepo() {
  try { return git('rev-parse', '--is-inside-work-tree') === 'true'; } catch (e) { return false; }
}

module.exports = { ROOT, PORTFOLIO_FILE, CALC_FILE, readPortfolio, readCalculated, loadState, git, isGitRepo };
