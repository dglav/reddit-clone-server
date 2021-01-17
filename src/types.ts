import Redis from "ioredis";
import { Request, Response } from "express";

export type MyContext = {
  redis: Redis.Redis;
  req: Request & { session: { userId?: number } };
  res: Response;
};
