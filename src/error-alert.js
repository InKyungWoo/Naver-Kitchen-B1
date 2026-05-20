/**
 * 에러 알림 이메일 (동일 유형은 1시간에 1회만 전송)
 */

const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
require("dotenv").config();

const ALERT_EMAIL = process.env.ALERT_EMAIL;
const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const STATE_FILE = path.join(__dirname, "..", ".alert-state.json");
const COOLDOWN_MS = 60 * 60 * 1000;

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch (_) {}
  return {};
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendErrorAlert(errorMessage, options = {}) {
  if (!ALERT_EMAIL || !IMAP_HOST || !IMAP_USER || !IMAP_PASS) return;

  const alertKey = options.alertKey || errorMessage.slice(0, 100);
  const force = Boolean(options.force);
  const state = loadState();
  const lastSent = state[alertKey];

  if (!force && lastSent && Date.now() - lastSent < COOLDOWN_MS) {
    console.log(`📧 에러 알림 생략 (1시간 내 동일 알림: ${alertKey})`);
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: IMAP_HOST.replace("imap.", "smtp."),
      port: 587,
      secure: false,
      auth: {
        user: IMAP_USER,
        pass: IMAP_PASS,
      },
    });

    await transporter.sendMail({
      from: IMAP_USER,
      to: ALERT_EMAIL,
      subject: "⚠️ [Kitchen Bot] 오류 발생",
      text: `Kitchen Bot 실행 중 오류가 발생했습니다.\n\n시간: ${new Date().toLocaleString("ko-KR")}\n오류: ${errorMessage}`,
    });

    state[alertKey] = Date.now();
    saveState(state);
    console.log("📧 에러 알림 메일 전송됨");
  } catch (e) {
    console.error("❌ 에러 알림 메일 전송 실패:", e.message);
  }
}

module.exports = { sendErrorAlert };
