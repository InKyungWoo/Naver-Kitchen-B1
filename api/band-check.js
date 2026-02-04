/**
 * 네이버 밴드 게시물 스크래퍼 → 슬랙 전송
 * Vercel Serverless Function (외부 cron 서비스로 호출)
 * 
 * 동작 방식:
 * 1. IMAP으로 네이버/네이버웍스 메일 체크
 * 2. 밴드 알림 메일에서 게시물 링크 추출
 * 3. Puppeteer로 해당 게시물 스크랩
 * 4. 슬랙으로 전송
 * 
 * 환경변수 필요:
 * - IMAP_HOST: IMAP 서버 (예: imap.worksmobile.com, imap.naver.com)
 * - IMAP_USER: 이메일 주소
 * - IMAP_PASS: 이메일 비밀번호 (앱 비밀번호 권장)
 * - BAND_COOKIES: Base64 인코딩된 쿠키 (login.js로 생성)
 * - SLACK_WEBHOOK_URL: 슬랙 Incoming Webhook URL
 * 
 * 호출 방법:
 * - cron-job.org 등 무료 cron 서비스에서 5분마다 GET /api/band-check 호출
 * - 또는 GitHub Actions에서 호출
 */

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const Imap = require('imap');
const { simpleParser } = require('mailparser');

module.exports = async (req, res) => {
  console.log('🚀 밴드 체크 시작...', new Date().toISOString());

  // 환경변수 확인
  const IMAP_HOST = process.env.IMAP_HOST;
  const IMAP_USER = process.env.IMAP_USER;
  const IMAP_PASS = process.env.IMAP_PASS;
  const BAND_COOKIES = process.env.BAND_COOKIES;
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS || !BAND_COOKIES || !SLACK_WEBHOOK_URL) {
    console.error('❌ 필수 환경변수가 설정되지 않았습니다.');
    return res.status(500).json({ 
      error: 'Missing environment variables',
      required: ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASS', 'BAND_COOKIES', 'SLACK_WEBHOOK_URL']
    });
  }

  try {
    // 1단계: IMAP으로 새 메일 체크
    console.log('📧 메일 체크 중...');
    const bandLinks = await checkMailForBandLinks(IMAP_HOST, IMAP_USER, IMAP_PASS);
    
    if (bandLinks.length === 0) {
      console.log('📭 새로운 밴드 알림 메일이 없습니다.');
      return res.status(200).json({ 
        success: true, 
        message: 'No new band notifications',
        checked: new Date().toISOString()
      });
    }

    console.log(`📬 새 밴드 링크 ${bandLinks.length}개 발견`);
    
    // 2단계: 각 링크에 대해 스크래핑 및 슬랙 전송
    const results = [];
    for (const link of bandLinks) {
      try {
        const result = await scrapeAndNotify(link, BAND_COOKIES, SLACK_WEBHOOK_URL);
        results.push(result);
      } catch (e) {
        console.error(`❌ 링크 처리 실패: ${link}`, e.message);
        results.push({ link, error: e.message });
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: `Processed ${results.length} posts`,
      results
    });

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * IMAP으로 밴드 알림 메일 체크
 */
async function checkMailForBandLinks(host, user, pass) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user,
      password: pass,
      host,
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    const bandLinks = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // 최근 24시간 내 읽지 않은 밴드 알림 메일 검색
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const searchDate = yesterday.toISOString().split('T')[0].replace(/-/g, '-');

        imap.search([
          'UNSEEN',
          ['SINCE', yesterday],
          ['OR', ['FROM', 'band'], ['SUBJECT', '밴드']]
        ], (err, results) => {
          if (err || !results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          console.log(`📧 읽지 않은 밴드 메일 ${results.length}개 발견`);

          const fetch = imap.fetch(results, { bodies: '', markSeen: true });

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;

                // 메일 본문에서 밴드 링크 추출
                const text = (parsed.text || '') + (parsed.html || '');
                const linkMatches = text.match(/https?:\/\/band\.us\/band\/\d+\/post\/\d+/g);
                
                if (linkMatches) {
                  linkMatches.forEach(link => {
                    if (!bandLinks.includes(link)) {
                      bandLinks.push(link);
                    }
                  });
                }
              });
            });
          });

          fetch.once('end', () => {
            imap.end();
          });
        });
      });
    });

    imap.once('error', reject);
    imap.once('end', () => resolve(bandLinks));
    imap.connect();
  });
}

/**
 * 특정 밴드 게시물 스크래핑 및 슬랙 전송
 */
async function scrapeAndNotify(postUrl, cookiesBase64, slackWebhookUrl) {
  const cookies = JSON.parse(Buffer.from(cookiesBase64, 'base64').toString('utf8'));
  
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setCookie(...cookies);

    console.log(`📍 게시물 페이지 이동: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // 게시물 내용 추출
    const post = await page.evaluate(() => {
      const author = document.querySelector('.postWriter .name, .author, [class*="author"]')?.textContent?.trim() || '알 수 없음';
      const time = document.querySelector('.postTime, .time, time')?.textContent?.trim() || '';
      const content = document.querySelector('.postBody .txt, .postText, [class*="content"]')?.textContent?.trim() || '';
      const images = Array.from(document.querySelectorAll('.postBody img, .photo img, [class*="image"] img'))
        .map(img => img.src || img.getAttribute('data-src'))
        .filter(src => src && !src.includes('profile'));

      return { author, time, content, images };
    });

    post.link = postUrl;
    console.log(`📝 게시물 추출 완료: ${post.author}`);

    // 슬랙 전송
    const slackPayload = buildSlackPayload(post);
    const response = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload)
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status}`);
    }

    console.log('✅ 슬랙 전송 완료!');
    return { link: postUrl, success: true, author: post.author };

  } finally {
    await browser.close();
  }
}

/**
 * 슬랙 메시지 페이로드 생성
 */
function buildSlackPayload(post) {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📢 밴드 새 게시물',
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*작성자:*\n${post.author}`
        },
        {
          type: 'mrkdwn',
          text: `*시간:*\n${post.time || '방금 전'}`
        }
      ]
    }
  ];

  // 본문 내용
  if (post.content) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: post.content.length > 2000 
          ? post.content.substring(0, 2000) + '...' 
          : post.content
      }
    });
  }

  // 이미지들 (최대 10개)
  const imagesToShow = post.images.slice(0, 10);
  imagesToShow.forEach((imageUrl, index) => {
    blocks.push({
      type: 'image',
      image_url: imageUrl,
      alt_text: `이미지 ${index + 1}`
    });
  });

  // 원본 링크
  if (post.link) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `<${post.link}|📎 원본 게시물 보기>`
        }
      ]
    });
  }

  blocks.push({
    type: 'divider'
  });

  return {
    blocks,
    // fallback for notifications
    text: `[밴드] ${post.author}: ${post.content.substring(0, 100)}...`
  };
}
