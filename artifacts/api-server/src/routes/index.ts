import { Router, type IRouter } from "express";
import firewatchRouter from "./firewatch";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(firewatchRouter);

export default router;
