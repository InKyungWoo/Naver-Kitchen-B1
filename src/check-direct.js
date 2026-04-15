/**
 * 밴드 직접 체크 → 슬랙 전송 (코어타임용)
 *
 * 이메일 알림을 기다리지 않고 직접 밴드 피드를 확인하여
 * 새 게시물이 있으면 슬랙으로 전송합니다.
 *
 * 코어타임(점심/저녁 시간대)에 10분 간격으로 실행하여
 * 메일 지연 문제를 해결합니다.
 *
 * 사용법: node src/check-direct.js
 */

const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const BAND_URL = process.env.BAND_URL;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const ALERT_EMAIL = process.env.ALERT_EMAIL;

const USER_DATA_DIR = path.join(__dirname, "..", ".browser-profile");
const PROCESSED_FILE = path.join(__dirname, "..", ".processed-posts.json");

async function main() {
  console.log("🔍 밴드 직접 체크 시작...", new Date().toLocaleString("ko-KR"));
  console.log("");

  if (!BAND_URL || !SLACK_WEBHOOK_URL) {
    console.error("❌ 필수 환경변수가 설정되지 않았습니다.");
    console.log("   BAND_URL, SLACK_WEBHOOK_URL");
    process.exit(1);
  }

  if (!fs.existsSync(USER_DATA_DIR)) {
    console.error("❌ 브라우저 프로필이 없습니다.");
    console.log("   먼저 npm run login을 실행하여 로그인하세요.");
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    userDataDir: USER_DATA_DIR,
  });

  try {
    console.log("🌐 밴드 피드 접속 중...");
    const page = await browser.newPage();

    // 밴드 피드 페이지 접속
    await page.goto(BAND_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 로그인 페이지로 리다이렉트 되었는지 확인
    if (page.url().includes("auth.band.us") || page.url().includes("/login")) {
      console.log("⚠️ 로그인이 필요합니다. npm run login 실행 필요");
      await sendErrorAlert("밴드 직접 체크: 로그인 세션 만료. npm run login 실행 필요.");
      return;
    }

    // 피드에서 게시물 링크들 추출
    const postLinks = await page.evaluate(() => {
      const links = [];
      const seenIds = new Set();

      // 게시물 링크 찾기 (다양한 선택자 시도)
      const selectors = ['a[href*="/post/"]', ".postWrap a", ".cPost a", '[class*="post"] a'];

      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((a) => {
          const href = a.href;
          if (href && href.includes("/post/")) {
            // URL에서 post ID 추출
            const match = href.match(/\/band\/\d+\/post\/(\d+)/);
            if (match && !seenIds.has(match[1])) {
              seenIds.add(match[1]);
              // 쿼리스트링 제거한 깔끔한 URL
              const cleanUrl = href.split("?")[0];
              links.push(cleanUrl);
            }
          }
        });
      });

      return links;
    });

    console.log(`   📋 피드에서 게시물 ${postLinks.length}개 발견`);

    if (postLinks.length === 0) {
      console.log("📭 피드에 게시물이 없습니다.");
      return;
    }

    // 처리된 게시물 목록 로드
    const processedPosts = loadProcessedPosts();

    // 새 게시물 필터링
    const newLinks = postLinks.filter((link) => {
      const postId = extractPostId(link);
      return postId && !processedPosts.includes(postId);
    });

    if (newLinks.length === 0) {
      console.log("✅ 새 게시물 없음 (모두 처리됨)");
      return;
    }

    console.log(`🆕 새 게시물 ${newLinks.length}개 발견`);

    // 가장 최신 게시물 1개만 처리 (첫 번째가 가장 최신)
    const latestLink = newLinks[0];
    console.log(`\n📍 최신 게시물 스크래핑: ${latestLink}`);

    const post = await scrapePost(browser, latestLink);

    if (post && post.content && post.content.length > 10) {
      console.log("📤 슬랙으로 전송 중...");
      await sendToSlack(post);
      console.log("✅ 전송 완료!");

      // 처리된 게시물로 기록
      const postId = extractPostId(latestLink);
      if (postId) {
        processedPosts.push(postId);
        saveProcessedPosts(processedPosts);
      }
    } else {
      console.log("⚠️ 게시물 스크래핑 실패 (내용 없음)");
    }

    console.log("\n🎉 완료!");
  } catch (error) {
    console.error("❌ 에러 발생:", error.message);
    await sendErrorAlert(`밴드 직접 체크 오류: ${error.message}`);
    throw error;
  } finally {
    const pages = await browser.pages();
    await Promise.all(pages.map((p) => p.close()));
    await browser.close();
    console.log("🔒 브라우저 종료");
  }
}

/**
 * 게시물 스크래핑
 */
async function scrapePost(browser, url) {
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (page.url().includes("auth.band.us") || page.url().includes("/login")) {
      console.log("   ⚠️ 로그인 필요");
      return null;
    }

    const post = await page.evaluate(() => {
      const authorEl = document.querySelector('.postWriter .name, .author, [class*="author"], [class*="writer"], .uAuthor, .bandName');
      const author = authorEl?.textContent?.trim() || "KITCHEN B1";

      const timeEl = document.querySelector('.postTime, .time, time, [class*="time"], .uTime, .createTime');
      const time = timeEl?.textContent?.trim() || "";

      let content = "";
      const contentSelectors = [
        ".postBody .txt",
        ".postText",
        ".dPostBody",
        ".textWrap",
        '[class*="postText"]',
        '[class*="PostText"]',
        ".text",
        "p.txt",
      ];
      for (const selector of contentSelectors) {
        const el = document.querySelector(selector);
        if (el && el.innerText?.trim()) {
          content = el.innerText.trim();
          break;
        }
      }

      const imageSelectors = [
        ".postBody img",
        ".photo img",
        ".dPhotoArea img",
        ".photoList img",
        ".imageWrap img",
        '[class*="photo"] img',
        '[class*="Photo"] img',
        '[class*="image"] img',
        ".postMedia img",
        'img[src*="phinf.pstatic.net"]',
      ];

      const images = [];
      const seenUrls = new Set();

      imageSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((img) => {
          const src = img.src || img.getAttribute("data-src") || img.getAttribute("data-original");
          if (
            src &&
            !src.includes("profile") &&
            !src.includes("avatar") &&
            !src.includes("icon") &&
            !src.includes("logo") &&
            !src.includes("emoji") &&
            src.includes("phinf.pstatic.net") &&
            !seenUrls.has(src)
          ) {
            seenUrls.add(src);
            images.push(src);
          }
        });
      });

      return { author, time, content, images };
    });

    post.link = url;
    return post;
  } catch (error) {
    console.error("   스크래핑 에러:", error.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * 슬랙으로 전송
 */
async function sendToSlack(post) {
  const timeStr = post.time || "";
  let mealType = "메뉴";
  if (timeStr.includes("오후")) {
    const hourMatch = timeStr.match(/오후\s*(\d+)/);
    if (hourMatch) {
      const hour = parseInt(hourMatch[1]);
      mealType = hour >= 5 ? "저녁 메뉴" : "점심 메뉴";
    }
  } else {
    mealType = "점심 메뉴";
  }

  const dateMatch = timeStr.match(/(\d+)월\s*(\d+)일/);
  const dateStr = dateMatch ? `${dateMatch[1]}월 ${dateMatch[2]}일` : "오늘";

  let content = post.content || "";
  if (content.length > 2000) {
    content = content.substring(0, 2000) + "...";
  }

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*😋 ${dateStr} ${mealType}*`,
      },
    },
  ];

  if (content) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: content,
      },
    });
  }

  const imagesToShow = post.images.slice(0, 3);
  console.log(`   🖼️ 이미지 ${imagesToShow.length}장 첨부`);
  imagesToShow.forEach((imageUrl, index) => {
    blocks.push({
      type: "image",
      image_url: imageUrl,
      alt_text: `메뉴 이미지 ${index + 1}`,
    });
  });

  if (post.link) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${post.link}|📎 밴드에서 보기>`,
        },
      ],
    });
  }

  const payload = {
    blocks,
    text: `[${dateStr} ${mealType}] ${post.content?.substring(0, 100) || "새 메뉴가 올라왔습니다"}...`,
  };

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status}`);
  }
}

function extractPostId(url) {
  const match = url.match(/\/post\/(\d+)/);
  return match ? match[1] : null;
}

function loadProcessedPosts() {
  try {
    if (fs.existsSync(PROCESSED_FILE)) {
      return JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf8"));
    }
  } catch (e) {}
  return [];
}

function saveProcessedPosts(posts) {
  const recentPosts = posts.slice(-100);
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify(recentPosts, null, 2));
}

async function sendErrorAlert(errorMessage) {
  if (!ALERT_EMAIL || !IMAP_HOST || !IMAP_USER || !IMAP_PASS) return;

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
      text: `Kitchen Bot 실행 중 오류가 발생했습니다.\n\n시간: ${new Date().toLocaleString("ko-KR")}\n오류: ${errorMessage}\n\nnpm run login 으로 재로그인이 필요할 수 있습니다.`,
    });

    console.log("📧 에러 알림 메일 전송됨");
  } catch (e) {
    console.error("❌ 에러 알림 메일 전송 실패:", e.message);
  }
}

main().catch(async (err) => {
  console.error("❌ 치명적 오류:", err.message);
  await sendErrorAlert(err.message);
  process.exit(1);
});
