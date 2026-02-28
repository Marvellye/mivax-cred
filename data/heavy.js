const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR);
}

// Helper to extract course data from the page
async function getCourses(page) {
  // Wait specifically for course cards rendered by AJAX
  await page.waitForSelector('div[data-course-id][data-region="course-content"]', { timeout: 30000 });

  return await page.evaluate(() => {
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
}

// Helper to extract specific course detail data
async function getCourseDetails(page) {
  // Give the page a moment to hydrate dynamic components
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    // 1. Extract Header Info
    const header = document.querySelector('header#page-header');
    const title = header?.querySelector('h1.header-heading')?.textContent?.trim();
    const category = header?.querySelector('div.category span.badge')?.textContent?.trim();
    
    const bgStyle = header?.getAttribute('style') || '';
    const bgMatch = bgStyle.match(/url\(["']?(.*?)["']?\)/);
    const backgroundImage = bgMatch ? bgMatch[1] : null;

    // Use Set to remove potential duplicates in instructors
    const instructorsFull = Array.from(document.querySelectorAll('div.instructor-info span.titles'))
      .map(el => el.textContent.trim());
    const instructors = [...new Set(instructorsFull)];

    const progressText = document.querySelector('div.progressbar-text-wrapper span')?.textContent?.trim();

    // 3. Extract Course Description
    const descriptionEl = document.querySelector('div.coursesummary');
    const description = descriptionEl ? Array.from(descriptionEl.querySelectorAll('p'))
      .map(p => p.textContent.trim())
      .filter(text => text.length > 0)
      .join('\n\n') : null;

    // 4. Extract Sections and Modules
    const sections = [];
    
    // Look for both the sidebar index and the main content area sections
    const sectionElements = document.querySelectorAll('div.courseindex-section, li.section.main');

    sectionElements.forEach((sectionEl, index) => {
      const sectionTitleLink = sectionEl.querySelector('a[data-for="section_title"], h3.sectionname a, h3.section-title, .courseindex-link');
      const sectionName = sectionTitleLink?.textContent?.trim();
      
      const sectionId = sectionEl.getAttribute('data-id') || 
                        sectionEl.getAttribute('data-sectionid') || 
                        sectionEl.getAttribute('data-number') || 
                        `sec-${index}`;

      const modules = [];
      const moduleElements = sectionEl.querySelectorAll('li.courseindex-item[data-for="cm"], li.activity');

      moduleElements.forEach(modEl => {
        const modLink = modEl.querySelector('a.courseindex-link, a.aalink, a');
        const nameEl = modEl.querySelector('span.instancename, span.courseindex-name, .text-truncate');
        const modName = nameEl?.textContent?.trim() || modLink?.textContent?.trim();
        const modUrl = modLink?.href?.trim();
        const modId = modEl.getAttribute('data-id') || modEl.id?.replace('module-', '');
        
        const completionImg = modEl.querySelector('span[data-for="cm_completion"] img, div.completioninfo img, img.completionicon');
        const isCompleted = completionImg?.src?.includes('completion_complete') || completionImg?.title?.includes('Done');
        
        let type = 'unknown';
        if (modUrl.includes('/mod/page/')) type = 'page';
        else if (modUrl.includes('/mod/quiz/')) type = 'quiz';
        else if (modUrl.includes('/mod/url/')) type = 'url';
        else if (modUrl.includes('/mod/forum/')) type = 'forum';
        else if (modUrl.includes('/mod/assign/')) type = 'assignment';
        else if (modUrl.includes('/mod/feedback/')) type = 'feedback';

        if (modName && modUrl && modUrl !== '#' && !modUrl.includes('togglecourseindexsection')) {
          modules.push({ 
            id: modId, 
            type: type,
            name: modName.replace(/ (To do|Done|Quiz|Page|URL|Forum|Feedback|Assignment)$/i, '').trim(), 
            url: modUrl,
            isCompleted: !!isCompleted 
          });
        }
      });

      const isDuplicate = sections.some(s => s.id === sectionId || (s.name === sectionName && s.modules.length === modules.length));
      
      if (sectionName && !isDuplicate) {
        sections.push({ 
          id: sectionId, 
          name: sectionName, 
          modules 
        });
      }
    });

    return {
      title,
      category,
      backgroundImage,
      description,
      instructors,
      progress: progressText,
      sections: sections.filter(s => s.modules.length > 0)
    };
  });
}

// Helper to extract specific module detail data
async function getModuleDetails(page, type) {
  await page.waitForTimeout(1500);

  return await page.evaluate((modType) => {
    const title = document.querySelector('h1.header-heading')?.textContent?.trim();
    const result = { title, type: modType };

    if (modType === 'page' || modType === 'url') {
      const iframes = Array.from(document.querySelectorAll('iframe'))
        .map(f => ({
          src: f.src,
          title: f.title || null,
          width: f.width || null,
          height: f.height || null
        }))
        .filter(f => f.src && !f.src.includes('about:blank'));
      
      result.iframes = iframes;

      if (modType === 'page') {
        const contentEl = document.querySelector('div.generalbox');
        result.contentHtml = contentEl?.innerHTML?.trim();
      }
    }

    if (modType === 'quiz') {
      const descriptionEl = document.querySelector('div.activity-description');
      result.description = descriptionEl?.textContent?.trim();
      
      const quizInfo = Array.from(document.querySelectorAll('div.quizinfo p'))
        .map(p => p.textContent.trim());
      result.quizInfo = quizInfo;

      const hasStartButton = !!document.querySelector('div.quizstartbuttondiv button');
      result.status = hasStartButton ? 'available' : 'locked_or_completed';
    }

    // 5. Navigation Links
    const getNavInfo = (selector) => {
      const link = document.querySelector(selector);
      if (!link) return null;
      const urlStr = link.href;
      if (!urlStr || urlStr === '#' || urlStr.includes('section.php')) return null;
      
      try {
        const url = new URL(urlStr);
        const id = url.searchParams.get('id');
        const typeMatch = url.pathname.match(/\/mod\/([^/]+)\//);
        if (id && typeMatch) {
          return { type: typeMatch[1], id: id };
        }
      } catch (e) {}
      return null;
    };

    result.navigation = {
      prev: getNavInfo('#prev-activity-link'),
      next: getNavInfo('#next-activity-link')
    };

    return result;
  }, type);
}

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
    
    if (!page.url().includes('/my/')) {
      await page.waitForSelector('input[name="email"]', { timeout: 10000 });
      await page.fill('input[name="email"]', username);
      await page.fill('input[name="password"]', password);
      await page.click('button:has-text("Login")');

      await Promise.race([
        page.waitForSelector('div[data-course-id][data-region="course-content"]', { timeout: 45000 }),
        page.waitForSelector('text=Incorrect email or password', { timeout: 15000 }).then(() => {
          throw new Error('Incorrect email or password');
        })
      ]).catch(e => {
          if (e.message.includes('timeout')) return;
          throw e;
      });
    }

    const courses = await getCourses(page);
    const sessionId = crypto.randomUUID();
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    await context.storageState({ path: sessionPath });

    await context.close();
    res.json({ sessionId, courses });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/courses/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);

  if (!fs.existsSync(sessionPath)) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  try {
    const context = await browser.newContext({ storageState: sessionPath });
    const page = await context.newPage();

    await page.goto('https://lms.miva.university/my/courses.php', { waitUntil: 'domcontentloaded' });

    if (page.url().includes('login/index.php') || page.url().includes('cas/login')) {
      await context.close();
      fs.unlinkSync(sessionPath);
      return res.status(401).json({ error: 'Session expired' });
    }

    const courses = await getCourses(page);
    await context.storageState({ path: sessionPath });
    await context.close();
    res.json({ courses });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/course/:id/:sessionId', async (req, res) => {
  const { id, sessionId } = req.params;
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);

  if (!fs.existsSync(sessionPath)) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  try {
    const context = await browser.newContext({ storageState: sessionPath });
    const page = await context.newPage();
    await page.goto(`https://lms.miva.university/course/view.php?id=${id}`, { waitUntil: 'domcontentloaded' });

    if (page.url().includes('login/index.php')) {
      await context.close();
      return res.status(401).json({ error: 'Session expired' });
    }

    const courseData = await getCourseDetails(page);
    await context.close();
    res.json({ id, ...courseData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/mod/:type/:id/:sessionId', async (req, res) => {
  const { type, id, sessionId } = req.params;
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);

  if (!fs.existsSync(sessionPath)) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  try {
    const context = await browser.newContext({ storageState: sessionPath });
    const page = await context.newPage();
    await page.goto(`https://lms.miva.university/mod/${type}/view.php?id=${id}`, { waitUntil: 'domcontentloaded' });

    if (page.url().includes('login/index.php')) {
      await context.close();
      return res.status(401).json({ error: 'Session expired' });
    }

    const modData = await getModuleDetails(page, type);
    await context.close();
    res.json({ id, ...modData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => console.log('Server running'));