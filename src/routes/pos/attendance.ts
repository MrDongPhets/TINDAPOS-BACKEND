import { Router } from 'express';
import {
  clockIn,
  clockOut,
  getAttendanceStatus,
  getMyAttendance,
} from '../../controllers/client/attendanceController';

const router = Router();

router.get('/status', getAttendanceStatus);
router.post('/clock-in', clockIn);
router.post('/clock-out', clockOut);
router.get('/my', getMyAttendance);

export default router;
