/**
 * 특정 게시물 URL을 슬랙으로 전송
 *
 * 사용법: npm run send -- <URL>
 * 예시: npm run send -- https://www.band.us/band/47113445/post/926902987
 */

const puppeteer = require("puppeteer");
const path = require("path");
require("dotenv").config();

const USER_DATA_DIR = path.join(__dirname, "..", ".browser-profile");
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const url = process.argv[2];

if (!url) {
  console.log("❌ URL을 입력해주세요");
  console.log("사용법: npm run send -- <URL>");
  console.log("예시: npm run send -- https://www.band.us/band/밴드번호/post/게시물번호");
  process.exit(1);
}

async function sendPost() {
  console.log("🌐 브라우저 시작...");
  const browser = await puppeteer.launch({
    headless: "new",
    userDataDir: USER_DATA_DIR,
  });

  try {
    const page = await browser.newPage();
    console.log(`📍 페이지 로딩: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    if (page.url().includes("auth.band.us") || page.url().includes("/login")) {
      console.log("❌ 로그인 필요 - npm run login 먼저 실행하세요");
      return;
    }

    const post = await page.evaluate(() => {
      const timeEl = document.querySelector(".postTime, .time, time, [class*='time']");
      const time = timeEl?.textContent?.trim() || "";

      let content = "";
      const selectors = [".postBody .txt", ".postText", ".dPostBody", ".textWrap", "[class*='postText']"];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.innerText?.trim()) {
          content = el.innerText.trim();
          break;
        }
      }

      const images = [];
      const seenUrls = new Set();

      // 게시물 본문 영역의 이미지만 가져오기
      const imageSelectors = [".postBody img", ".postMedia img", ".imageWrap img", '[class*="photo"] img', '[class*="image"] img'];

      imageSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((img) => {
          const src = img.src || img.dataset?.src;
          if (
            src &&
            src.includes("phinf.pstatic.net") &&
            !src.includes("profile") &&
            !src.includes("avatar") &&
            !src.includes("icon") &&
            !src.includes("logo") &&
            !src.includes("emoji") &&
            img.width > 100 &&
            !seenUrls.has(src)
          ) {
            seenUrls.add(src);
            images.push(src);
          }
        });
      });

      return { time, content, images };
    });

    post.link = url;

    console.log(`📄 내용: ${post.content?.substring(0, 50)}...`);
    console.log(`🖼️ 이미지: ${post.images.length}개`);

    if (!post.content || post.content.length < 10) {
      console.log("❌ 게시물 내용을 가져오지 못했습니다");
      return;
    }

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

    const dateMatch = timeStr.match(/(\d+)월\s*(\d+)일/);
    const dateStr = dateMatch ? `${dateMatch[1]}월 ${dateMatch[2]}일` : "오늘";

    // 슬랙 블록 생성
    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*😋 ${dateStr} ${mealType}*` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: post.content.substring(0, 2000) },
      },
    ];

    post.images.slice(0, 3).forEach((img, i) => {
      blocks.push({
        type: "image",
        image_url: img,
        alt_text: `메뉴 이미지 ${i + 1}`,
      });
    });

    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `<${post.link}|📎 밴드에서 보기>` }],
    });

    // 슬랙 전송
    console.log("📤 슬랙으로 전송 중...");
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks, text: `[${dateStr} ${mealType}]` }),
    });

    if (res.ok) {
      console.log("✅ 전송 완료!");
    } else {
      console.log(`❌ 전송 실패: ${res.status}`);
    }
  } catch (error) {
    console.error("❌ 에러:", error.message);
  } finally {
    await browser.close();
    console.log("🔒 브라우저 종료");
  }
}

sendPost();
