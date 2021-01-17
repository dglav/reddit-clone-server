import { validateRegister } from "./../utils/validateRegister";
import argon2 from "argon2";
import {
  Arg,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from "type-graphql";
import { MyContext } from "./../types";
import { User } from "./../entities/User";
import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from "./../constants";
import { UsernamePasswordInput } from "./UsernamePasswordInput";
import { sendEmail } from "../utils/sendEmail";
import { v4 } from "uuid";

@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => User, { nullable: true })
  user?: User;
}

@Resolver()
export class UserResolver {
  @Query(() => User, { nullable: true })
  async me(@Ctx() { em, req }: MyContext) {
    const id = req.session.userId;
    // You are not logged in
    if (!id) return null;
    // You are logged in
    const user = await em.findOne(User, { id });
    return user;
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg("options") options: UsernamePasswordInput,
    @Ctx() { em, req }: MyContext
  ): Promise<UserResponse> {
    const errors = validateRegister(options);
    if (errors) return { errors };

    const hashedPassword = await argon2.hash(options.password);
    try {
      const user = em.create(User, {
        username: options.username,
        password: hashedPassword,
        email: options.email,
      });
      await em.persistAndFlush(user);

      // Log in the user after registration
      req.session.userId = user.id;

      return { user };
    } catch (error) {
      // duplicate username error
      if (error.code === "23505" || error.detail.includes("already exists")) {
        return {
          errors: [
            { field: "username", message: "that username already exists" },
          ],
        };
      }
      return {
        errors: [
          { field: "unknown", message: "an unknown error has occurred" },
        ],
      };
    }
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg("usernameOrEmail") usernameOrEmail: string,
    @Arg("password") password: string,
    @Ctx() { em, req }: MyContext
  ): Promise<UserResponse> {
    const user = await em.findOne(
      User,
      usernameOrEmail.includes("@")
        ? {
            email: usernameOrEmail,
          }
        : {
            username: usernameOrEmail,
          }
    );
    if (!user) {
      return {
        errors: [
          {
            field: "usernameOrEmail",
            message: "that username/email doesn't exist",
          },
        ],
      };
    }
    const valid = await argon2.verify(user.password, password);
    if (!valid) {
      return {
        errors: [{ field: "password", message: "incorrect password" }],
      };
    }

    req.session.userId = user.id;

    return { user };
  }

  @Mutation(() => Boolean)
  async logout(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) =>
      req.session.destroy((err) => {
        res.clearCookie(COOKIE_NAME);
        if (err) {
          console.error(err);
          resolve(false);
          return;
        }
        resolve(true);
        return;
      })
    );
  }

  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg("email") email: string,
    @Ctx() { em, redis }: MyContext
  ) {
    const user = await em.findOne(User, { email });
    if (!user) {
      // email is not in the database
      return true; // so client doesn't know if email is valid or not
    }

    const token = v4();

    await redis.set(
      `${FORGET_PASSWORD_PREFIX}${token}`,
      user.id,
      "ex",
      1000 * 60 * 60 * 24 * 3
    ); // 3 days

    sendEmail(
      email,
      `<a href="http://localhost:3000/change-password/${token}">reset password</a>`
    );

    return true;
  }

  @Mutation(() => UserResponse)
  async changePassword(
    @Arg("token") token: string,
    @Arg("newPassword") newPassword: string,
    @Ctx() { em, redis, req }: MyContext
  ): Promise<UserResponse> {
    // Check password length
    if (newPassword.length <= 3) {
      return {
        errors: [
          { field: "newPassword", message: "password is not long enough" },
        ],
      };
    }

    const userId = await redis.get(`${FORGET_PASSWORD_PREFIX}${token}`);
    if (!userId)
      return { errors: [{ field: "token", message: "token expired" }] };

    const user = await em.findOne(User, { id: parseInt(userId) });

    if (!user) {
      return { errors: [{ field: "token", message: "user no longer exists" }] };
    }

    const hashedNewPassword = await argon2.hash(newPassword);

    user.password = hashedNewPassword;
    em.persistAndFlush(user);

    // log in user after change password
    req.session.userId = user.id;

    // remove token
    await redis.del(`${FORGET_PASSWORD_PREFIX}${token}`);

    return { user };
  }
}