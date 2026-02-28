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
    // Priority to courseindex-section as it usually has the full structure
    const sectionElements = document.querySelectorAll('div.courseindex-section, li.section.main');

    sectionElements.forEach((sectionEl, index) => {
      // Find title - handles both index and main content layouts
      const sectionTitleLink = sectionEl.querySelector('a[data-for="section_title"], h3.sectionname a, h3.section-title, .courseindex-link');
      const sectionName = sectionTitleLink?.textContent?.trim();
      
      // Fallback for ID: data-id -> data-sectionid -> data-number -> incremental index
      const sectionId = sectionEl.getAttribute('data-id') || 
                        sectionEl.getAttribute('data-sectionid') || 
                        sectionEl.getAttribute('data-number') || 
                        `sec-${index}`;

      const modules = [];
      // Look for modules in the course index list or the main activity list
      const moduleElements = sectionEl.querySelectorAll('li.courseindex-item[data-for="cm"], li.activity');

      moduleElements.forEach(modEl => {
        // Find module link and name - flexible selector for different layouts
        const modLink = modEl.querySelector('a.courseindex-link, a.aalink, a');
        const nameEl = modEl.querySelector('span.instancename, span.courseindex-name, .text-truncate');
        const modName = nameEl?.textContent?.trim() || modLink?.textContent?.trim();
        const modUrl = modLink?.href?.trim();
        const modId = modEl.getAttribute('data-id') || modEl.id?.replace('module-', '');
        
        // Completion status
        const completionImg = modEl.querySelector('span[data-for="cm_completion"] img, div.completioninfo img, img.completionicon');
        const isCompleted = completionImg?.src?.includes('completion_complete') || completionImg?.title?.includes('Done');
        
        if (modName && modUrl && modUrl !== '#' && !modUrl.includes('togglecourseindexsection')) {
          modules.push({ 
            id: modId, 
            name: modName.replace(/ To do$/ , '').replace(/ Done$/ , '').trim(), 
            url: modUrl, 
            isCompleted: !!isCompleted 
          });
        }
      });

      // Avoid adding duplicate sections and skip those with no name/modules
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
      sections: sections.filter(s => s.modules.length > 0) // Only return sections with content
    };
  });
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
          if (e.message.includes('timeout')) return;
          throw e;
      });
    }

    const courses = await getCourses(page);
    
    // Generate session ID and save storage state
    const sessionId = crypto.randomUUID();
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    await context.storageState({ path: sessionPath });

    await context.close();
    res.json({ sessionId, courses });

  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
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

    // Route to block non-essential resources
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(type) && !route.request().url().includes('miva')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Go directly to dashboard
    await page.goto('https://lms.miva.university/my/courses.php', { waitUntil: 'domcontentloaded' });

    // Check if session is still valid
    if (page.url().includes('login/index.php') || page.url().includes('cas/login')) {
      await context.close();
      fs.unlinkSync(sessionPath); // Clean up expired session
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }

    const courses = await getCourses(page);
    
    // Update the session state (optional but good for long-lived sessions)
    await context.storageState({ path: sessionPath });

    await context.close();
    res.json({ courses });

  } catch (error) {
    console.error('Failed to get courses from session:', error);
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

    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(type) && !route.request().url().includes('miva')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Go to specific course page
    const courseUrl = `https://lms.miva.university/course/view.php?id=${id}`;
    await page.goto(courseUrl, { waitUntil: 'domcontentloaded' });

    // Check if session is still valid
    if (page.url().includes('login/index.php') || page.url().includes('cas/login')) {
      await context.close();
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }

    // Wait for the course header or content to appear
    await page.waitForSelector('header#page-header, div.courseindex-section', { timeout: 30000 });

    const courseData = await getCourseDetails(page);
    
    await context.close();
    res.json({ id, ...courseData });

  } catch (error) {
    console.error(`Failed to get course ${id}:`, error);
    res.status(500).json({ error: error.message });
  }
});



app.listen(3000, () => console.log('Server running'));