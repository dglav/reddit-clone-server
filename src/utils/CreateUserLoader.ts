import DataLoader from "dataloader";
import { User } from "../entities/User";

// userId = [1, 78, 8, 9]
// objects that are the user [{id: 1, username: 'tim'}, {id: 78, username: 'john} ...]
export const createUserLoader = () => {
  return new DataLoader<number, User>(async (userIds) => {
    const users = await User.findByIds(userIds as number[]);
    const userIdToUser: Record<number, User> = {};
    users.forEach((user: User) => {
      userIdToUser[user.id] = user;
    });
    return userIds.map((userId) => userIdToUser[userId]);
  });
};
