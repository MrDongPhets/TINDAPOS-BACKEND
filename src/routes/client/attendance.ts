import { Router } from 'express';
import {
  getAllAttendance,
  getAttendanceSummary,
} from '../../controllers/client/attendanceController';

const router = Router();

router.get('/', getAllAttendance);
router.get('/summary', getAttendanceSummary);

export default router;
