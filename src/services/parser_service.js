const cheerio = require('cheerio');
const { proxyImg } = require('../utils/proxy_img');

function parseCourses(html, sessionId) {
  const $ = cheerio.load(html);
  const courses = [];
  $('div[data-course-id][data-region="course-content"]').each((i, el) => {
    const $el = $(el);
    const id = $el.attr('data-course-id');
    const $link = $el.find('a.coursename');
    const name = $link.find('span.multiline').text().trim();
    const url = $link.attr('href')?.trim();
    const imgDiv = $el.find('div.card-img.dashboard-card-img');
    let image = null;
    const bg = imgDiv.attr('style') || '';
    const match = bg.match(/url\(["']?(.*?)["']?\)/);
    if (match) image = proxyImg(match[1], sessionId);
    if (id && name && url) {
      courses.push({ id, name, url, image });
    }
  });
  return courses;
}

function parseCourseDetails(html, sessionId) {
  const $ = cheerio.load(html);
  const title = $('header#page-header h1.header-heading').text().trim();
  const category = $('header#page-header div.category span.badge').text().trim();
  const bgStyle = $('header#page-header').attr('style') || '';
  const bgMatch = bgStyle.match(/url\(["']?(.*?)["']?\)/);
  const backgroundImage = bgMatch ? proxyImg(bgMatch[1], sessionId) : null;
  const instructors = [...new Set($('div.instructor-info span.titles').map((i, el) => $(el).text().trim()).get())];
  const progress = $('div.progressbar-text-wrapper span').first().text().trim();
  const description = $('div.coursesummary p').map((i, el) => $(el).text().trim()).get().filter(t => t.length > 0).join('\n\n');

  const sections = [];
  $('div.courseindex-section, li.section.main').each((i, sec) => {
    const $sec = $(sec);
    const sectionTitleLink = $sec.find('a[data-for="section_title"], h3.sectionname a, h3.section-title, .courseindex-link').first();
    const sectionName = sectionTitleLink.text().trim();
    const sectionId = $sec.attr('data-id') || $sec.attr('data-sectionid') || $sec.attr('data-number') || `sec-${i}`;
    const modules = [];
    $sec.find('li.courseindex-item[data-for="cm"], li.activity').each((j, mod) => {
      const $mod = $(mod);
      const $link = $mod.find('a.courseindex-link, a.aalink, a').first();
      const $name = $mod.find('span.instancename, span.courseindex-name, .text-truncate').first();
      const modName = $name.text().trim() || $link.text().trim();
      const modUrl = $link.attr('href')?.trim();
      const modId = $mod.attr('data-id') || $mod.attr('id')?.replace('module-', '');
      if (!modUrl || modUrl === '#' || modUrl.includes('togglecourseindexsection')) return;
      const completionImg = $mod.find('span[data-for="cm_completion"] img, div.completioninfo img, img.completionicon');
      const isCompleted = completionImg.attr('src')?.includes('completion_complete') || completionImg.attr('title')?.includes('Done');
      let type = 'unknown';
      if (modUrl.includes('/mod/page/')) type = 'page';
      else if (modUrl.includes('/mod/quiz/')) type = 'quiz';
      else if (modUrl.includes('/mod/url/')) type = 'url';
      else if (modUrl.includes('/mod/forum/')) type = 'forum';
      else if (modUrl.includes('/mod/assign/')) type = 'assignment';
      else if (modUrl.includes('/mod/feedback/')) type = 'feedback';
      modules.push({
        id: modId, type,
        name: modName.replace(/ (To do|Done|Quiz|Page|URL|Forum|Feedback|Assignment)$/i, '').trim(),
        url: modUrl, isCompleted: !!isCompleted
      });
    });
    if (sectionName && modules.length > 0) sections.push({ id: sectionId, name: sectionName, modules });
  });
  return { title, category, backgroundImage, description, instructors, progress, sections };
}

function parseModuleDetails(html, type) {
  const $ = cheerio.load(html);
  const title = $('h1.header-heading').text().trim();
  const result = { title, type };
  if (type === 'page' || type === 'url') {
    result.iframes = $('iframe').map((i, el) => ({
      src: $(el).attr('src'),
      title: $(el).attr('title') || null,
      width: $(el).attr('width') || null,
      height: $(el).attr('height') || null
    })).get().filter(f => f.src && !f.src.includes('about:blank'));
    if (type === 'page') result.contentHtml = $('div.generalbox').html()?.trim();
  }
  if (type === 'quiz') {
    result.description = $('div.activity-description').text().trim();
    result.quizInfo = $('div.quizinfo p').map((i, el) => $(el).text().trim()).get();
    result.status = $('div.quizstartbuttondiv button').length > 0 ? 'available' : 'locked_or_completed';
  }
  const getNav = (selector) => {
    const href = $(selector).attr('href');
    if (!href || href === '#' || href.includes('section.php')) return null;
    try {
      const url = new URL(href);
      const id = url.searchParams.get('id');
      const typeMatch = url.pathname.match(/\/mod\/([^/]+)\//);
      return id && typeMatch ? { type: typeMatch[1], id } : null;
    } catch (e) { return null; }
  };
  result.navigation = { prev: getNav('#prev-activity-link'), next: getNav('#next-activity-link') };
  return result;
}

module.exports = {
  parseCourses,
  parseCourseDetails,
  parseModuleDetails
};
