const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth_controller');
const coursesController = require('../controllers/courses_controller');
const imgController = require('../controllers/img_controller');
const studentController = require('../controllers/student_controller');

router.get('/', (req, res) => {
  res.send('MivaX API is running!');
});

router.post('/login', authController.login);

// --- User & SIS Core Routes ---
router.get('/user/:sessionId', studentController.getMe);
router.get('/dashboard/:sessionId', studentController.getDashboard);
router.get('/payment-records/:sessionId', studentController.getPaymentRecords);
router.get('/notifications/:sessionId', studentController.getNotifications);

// --- Specialized Dashboard Data (Broken down for ease of use) ---
router.get('/student/academic-summary/:sessionId', studentController.getAcademicSummary);
router.get('/student/academic-levels/:sessionId', studentController.getAcademicLevels);
router.get('/student/transcript/:sessionId', studentController.getFullTranscript);
router.get('/student/transcript/:level/:sessionId', studentController.getTranscript);
router.get('/student/current-courses/:sessionId', studentController.getCurrentCourses);
router.get('/student/registration-status/:sessionId', studentController.getRegistrationStatus);

// --- LMS Crawler Routes ---
router.get('/courses/:sessionId', coursesController.getCourses);
router.get('/course/:id/:sessionId', coursesController.getCourseDetails);
router.get('/mod/:type/:id/:sessionId', coursesController.getModuleDetails);
router.get('/img/:base64url/:sessionId', imgController.proxyImg);

module.exports = router;
