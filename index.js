const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

let browser;

(async () => {
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage']
  });
})();

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(type) && !route.request().url().includes('miva')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto('https://lms.miva.university', { waitUntil: 'domcontentloaded' });
    
    // Check if we are already logged in (unlikely in new context, but safe)
    if (!page.url().includes('/my/')) {
      await page.waitForSelector('input[name="email"]', { timeout: 10000 });
      await page.fill('input[name="email"]', username);
      await page.fill('input[name="password"]', password);

      // Perform login click
      await page.click('button:has-text("Login")');

      // Wait for either the dashboard to load OR an error message to appear
      await Promise.race([
        page.waitForSelector('div[data-course-id][data-region="course-content"]', { timeout: 45000 }),
        page.waitForSelector('text=Incorrect email or password', { timeout: 15000 }).then(() => {
          throw new Error('Incorrect email or password');
        })
      ]).catch(e => {
          if (e.message.includes('timeout')) {
              // If it's just a transition, let the main selector wait handle it
              return;
          }
          throw e;
      });
    }

    // Wait specifically for course cards rendered by AJAX
    await page.waitForSelector('div[data-course-id][data-region="course-content"]', { timeout: 30000 });

    const courses = await page.evaluate(() => {
      const courseElements = document.querySelectorAll('div[data-course-id][data-region="course-content"]');
      const results = [];
      courseElements.forEach(el => {
        const id = el.getAttribute('data-course-id');
        const link = el.querySelector('a.coursename');
        const name = link?.querySelector('span.multiline')?.textContent?.trim();
        const url = link?.href?.trim();

        const imgDiv = el.querySelector('div.card-img.dashboard-card-img');
        let image = null;
        if (imgDiv) {
          const bg = imgDiv.style.backgroundImage;
          const match = bg.match(/url\(["']?(.*?)["']?\)/);
          if (match) image = match[1];
        }

        if (id && name && url) {
          results.push({ id, name, url, image });
        }
      });
      return results;
    });

    await context.close();
    res.json({ courses });

  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.listen(3000, () => console.log('Server running'));