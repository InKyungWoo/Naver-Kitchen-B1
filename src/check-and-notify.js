/**
 * 메일 체크 → 밴드 스크래핑 → 슬랙 전송 (로컬용)
 *
 * 1. IMAP으로 읽지 않은 밴드 알림 메일 체크
 * 2. 메일에서 게시물 링크 추출
 * 3. 브라우저 프로필로 해당 게시물 스크래핑
 * 4. 슬랙으로 전송
 *
 * 사용법: node scripts/check-and-notify.js
 */

const puppeteer = require("puppeteer");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const ALERT_EMAIL = process.env.ALERT_EMAIL; // 에러 알림 받을 이메일

// 브라우저 프로필 경로
const USER_DATA_DIR = path.join(__dirname, "..", ".browser-profile");

// 처리된 게시물 ID 저장 파일
const PROCESSED_FILE = path.join(__dirname, "..", ".processed-posts.json");

async function main() {
  console.log("🚀 밴드 체크 시작...", new Date().toLocaleString("ko-KR"));
  console.log("");

  // 환경변수 확인
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS || !SLACK_WEBHOOK_URL) {
    console.error("❌ 필수 환경변수가 설정되지 않았습니다.");
    console.log("   IMAP_HOST, IMAP_USER, IMAP_PASS, SLACK_WEBHOOK_URL");
    process.exit(1);
  }

  // 브라우저 프로필 확인
  if (!fs.existsSync(USER_DATA_DIR)) {
    console.error("❌ 브라우저 프로필이 없습니다.");
    console.log("   먼저 npm run login을 실행하여 로그인하세요.");
    process.exit(1);
  }

  try {
    // 1단계: 메일에서 밴드 링크 추출
    console.log("📧 메일 체크 중...");
    const bandLinks = await checkMailForBandLinks();

    if (bandLinks.length === 0) {
      console.log("📭 새로운 밴드 알림 메일이 없습니다.");
      console.log("✅ 완료");
      return;
    }

    console.log(`📬 새 밴드 링크 ${bandLinks.length}개 발견`);

    // 처리된 게시물 목록 로드
    const processedPosts = loadProcessedPosts();

    // 새 링크만 필터링
    const newLinks = bandLinks.filter((link) => {
      const postId = extractPostId(link);
      return postId && !processedPosts.includes(postId);
    });

    if (newLinks.length === 0) {
      console.log("⏭️ 모든 게시물이 이미 처리되었습니다.");
      console.log("✅ 완료");
      return;
    }

    // 🔥 가장 최신 게시물 1개만 처리 (마지막 링크가 가장 최신)
    const latestLink = newLinks[newLinks.length - 1];
    console.log(`🆕 최신 게시물 1개 처리 (총 ${newLinks.length}개 중)`);
    console.log("");

    // 2단계: 브라우저로 스크래핑
    console.log("🌐 브라우저 시작...");
    const browser = await puppeteer.launch({
      headless: true, // 백그라운드 실행
      defaultViewport: { width: 1280, height: 800 },
      userDataDir: USER_DATA_DIR,
    });

    try {
      const link = latestLink;
      console.log(`\n📍 게시물 스크래핑: ${link}`);

      const post = await scrapePost(browser, link);

      if (post) {
        // 슬랙 전송
        console.log("📤 슬랙으로 전송 중...");
        await sendToSlack(post);
        console.log("✅ 전송 완료!");

        // 처리된 게시물로 기록
        const postId = extractPostId(link);
        if (postId) {
          processedPosts.push(postId);
          saveProcessedPosts(processedPosts);
        }
      } else {
        console.log("⚠️ 게시물 스크래핑 실패");
      }
    } finally {
      await browser.close();
      console.log("\n🔒 브라우저 종료");
    }

    console.log("\n🎉 모든 작업 완료!");
  } catch (error) {
    console.error("❌ 에러 발생:", error.message);
    console.error(error);
    process.exit(1);
  }
}

/**
 * IMAP으로 밴드 알림 메일 체크
 */
function checkMailForBandLinks() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: IMAP_USER,
      password: IMAP_PASS,
      host: IMAP_HOST,
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const bandLinks = [];

    imap.once("ready", () => {
      // Kitchen B1 폴더 열기
      imap.openBox("Kitchen B1", false, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // 읽지 않은 BAND 메일 검색
        imap.search(["UNSEEN", ["FROM", "BAND"]], (err, results) => {
          if (err || !results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          console.log(`   📧 새 밴드 메일 ${results.length}개 발견`);

          const fetch = imap.fetch(results, { bodies: "", markSeen: true });
          let pending = results.length;

          fetch.on("message", (msg) => {
            msg.on("body", (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) {
                  pending--;
                  if (pending === 0) imap.end();
                  return;
                }

                // 메일 본문에서 밴드 링크 추출
                const text = (parsed.text || "") + (parsed.html || "");
                const linkMatches = text.match(/https?:\/\/(www\.)?band\.us\/band\/\d+\/post\/\d+/g);

                if (linkMatches) {
                  linkMatches.forEach((link) => {
                    if (!bandLinks.includes(link)) {
                      bandLinks.push(link);
                    }
                  });
                }

                pending--;
                if (pending === 0) imap.end();
              });
            });
          });

          fetch.once("error", (err) => {
            imap.end();
            reject(err);
          });

          fetch.once("end", () => {});
        });
      });
    });

    imap.once("error", reject);
    imap.once("end", () => resolve(bandLinks));
    imap.connect();
  });
}

/**
 * 게시물 스크래핑
 */
async function scrapePost(browser, url) {
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 로그인 페이지로 리다이렉트 되었는지 확인
    if (page.url().includes("auth.band.us") || page.url().includes("/login")) {
      console.log("   ⚠️ 로그인 필요 - npm run login 실행 필요");
      return null;
    }

    // 게시물 내용 추출
    const post = await page.evaluate(() => {
      // 작성자
      const authorEl = document.querySelector('.postWriter .name, .author, [class*="author"], [class*="writer"], .uAuthor, .bandName');
      const author = authorEl?.textContent?.trim() || "KITCHEN B1";

      // 작성 시간
      const timeEl = document.querySelector('.postTime, .time, time, [class*="time"], .uTime, .createTime');
      const time = timeEl?.textContent?.trim() || "";

      // 본문 텍스트 - 여러 선택자 시도 (innerText로 줄바꿈 유지)
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

      // 이미지 URL들 - 다양한 선택자로 추출
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
            src.includes("phinf.pstatic.net") && // 밴드 이미지 서버
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
  // 시간에서 점심/저녁 판단
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

  // 날짜 추출 (예: "2월 4일")
  const dateMatch = timeStr.match(/(\d+)월\s*(\d+)일/);
  const dateStr = dateMatch ? `${dateMatch[1]}월 ${dateMatch[2]}일` : "오늘";

  // 본문 정리
  let content = post.content || "";
  if (content.length > 2000) {
    content = content.substring(0, 2000) + "...";
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `😋 ${dateStr} ${mealType}`,
        emoji: true,
      },
    },
  ];

  // 본문 내용
  if (content) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: content,
      },
    });
  }

  // 이미지들 (최대 3개)
  const imagesToShow = post.images.slice(0, 3);
  console.log(`   🖼️ 이미지 ${imagesToShow.length}장 첨부`);
  imagesToShow.forEach((imageUrl, index) => {
    blocks.push({
      type: "image",
      image_url: imageUrl,
      alt_text: `메뉴 이미지 ${index + 1}`,
    });
  });

  // 원본 링크
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

/**
 * 게시물 ID 추출
 */
function extractPostId(url) {
  const match = url.match(/\/post\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * 처리된 게시물 목록 로드
 */
function loadProcessedPosts() {
  try {
    if (fs.existsSync(PROCESSED_FILE)) {
      return JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf8"));
    }
  } catch (e) {
    // 파일이 없거나 파싱 에러
  }
  return [];
}

/**
 * 처리된 게시물 목록 저장
 */
function saveProcessedPosts(posts) {
  // 최근 100개만 유지
  const recentPosts = posts.slice(-100);
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify(recentPosts, null, 2));
}

/**
 * 에러 알림 이메일 전송
 */
async function sendErrorAlert(errorMessage) {
  if (!ALERT_EMAIL) return;

  try {
    const transporter = nodemailer.createTransport({
      host: IMAP_HOST.replace("imap.", "smtp."), // imap → smtp
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

// 실행
main().catch(async (err) => {
  console.error("❌ 치명적 오류:", err.message);
  await sendErrorAlert(err.message);
  process.exit(1);
});
