/**
 * 세션 유지용 스크립트
 * 브라우저로 밴드 방문만 해서 쿠키 갱신
 */

const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");
const path = require("path");
require("dotenv").config();

const USER_DATA_DIR = path.join(__dirname, "..", ".browser-profile");
const BAND_URL = process.env.BAND_URL || "https://band.us/home";
const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const ALERT_EMAIL = process.env.ALERT_EMAIL;

async function sendErrorAlert(message) {
  if (!ALERT_EMAIL) return;
  
  try {
    const transporter = nodemailer.createTransport({
      host: IMAP_HOST.replace("imap.", "smtp."),
      port: 587,
      secure: false,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
    });

    await transporter.sendMail({
      from: IMAP_USER,
      to: ALERT_EMAIL,
      subject: "⚠️ [Kitchen Bot] 세션 만료",
      text: `세션이 만료되었습니다.\n\n시간: ${new Date().toLocaleString("ko-KR")}\n내용: ${message}\n\nnpm run login 으로 재로그인이 필요합니다.`,
    });
    
    console.log("📧 알림 메일 전송됨");
  } catch (e) {
    console.error("❌ 메일 전송 실패:", e.message);
  }
}

async function keepSession() {
  console.log("🔄 세션 유지 시작...", new Date().toLocaleString("ko-KR"));

  const browser = await puppeteer.launch({
    headless: "new",
    userDataDir: USER_DATA_DIR,
  });

  try {
    const page = await browser.newPage();
    await page.goto(BAND_URL, { waitUntil: "networkidle2", timeout: 30000 });
    
    // 로그인 상태 확인
    if (page.url().includes("auth.band.us") || page.url().includes("/login")) {
      console.log("⚠️ 로그인 풀림 - npm run login 필요");
      await sendErrorAlert("로그인이 풀렸습니다. npm run login 실행 필요.");
    } else {
      console.log("✅ 세션 유지 완료");
    }
  } catch (error) {
    console.error("❌ 에러:", error.message);
    await sendErrorAlert(error.message);
  } finally {
    await browser.close();
  }
}

keepSession();
