const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth_controller');
const coursesController = require('../controllers/courses_controller');
const imgController = require('../controllers/img_controller');
const studentController = require('../controllers/student_controller');

router.get('/', (req, res) => {
  res.send('Miva LMS Scraper API is running!');
});

router.post('/login', authController.login);
router.get('/user/:sessionId', studentController.getMe);
router.get('/dashboard/:sessionId', studentController.getDashboard);
router.get('/payment-records/:sessionId', studentController.getPaymentRecords);
router.get('/notifications/:sessionId', studentController.getNotifications);
router.get('/courses/:sessionId', coursesController.getCourses);
router.get('/course/:id/:sessionId', coursesController.getCourseDetails);
router.get('/mod/:type/:id/:sessionId', coursesController.getModuleDetails);
router.get('/img/:base64url/:sessionId', imgController.proxyImg);

module.exports = router;
