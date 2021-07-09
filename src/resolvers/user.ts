import { validateRegister } from "./../utils/validateRegister";
import argon2 from "argon2";
import {
  Arg,
  Ctx,
  Field,
  FieldResolver,
  Mutation,
  ObjectType,
  Query,
  Resolver,
  Root,
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

@Resolver(User)
export class UserResolver {
  @FieldResolver(() => String)
  email(@Root() user: User, @Ctx() { req }: MyContext) {
    // this is the current user and it's okay to show them their own email
    if (req.session.userId === user.id) {
      return user.email;
    }
    // current user wants to see someone else's email
    return "";
  }

  @Query(() => User, { nullable: true })
  async me(@Ctx() { req }: MyContext) {
    const id = req.session.userId;
    // You are not logged in
    if (!id) return null;
    // You are logged in
    return User.findOne(id);
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg("options") options: UsernamePasswordInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const errors = validateRegister(options);
    if (errors) return { errors };

    const hashedPassword = await argon2.hash(options.password);
    try {
      const user = await User.create({
        username: options.username,
        password: hashedPassword,
        email: options.email,
      }).save();

      // Log in the user after registration
      req.session.userId = user.id;

      return { user };
    } catch (error) {
      // duplicate username error
      if (error.code === "23505" || error.detail?.includes("already exists")) {
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
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const user = await User.findOne(
      usernameOrEmail.includes("@")
        ? {
            where: { email: usernameOrEmail },
          }
        : {
            where: { username: usernameOrEmail },
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
    @Ctx() { redis }: MyContext
  ) {
    console.log({ email });
    const user = await User.findOne({ where: { email: email } });

    console.log({ user });

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
    @Ctx() { redis, req }: MyContext
  ): Promise<UserResponse> {
    // Check password length
    if (newPassword.length < 3) {
      return {
        errors: [
          { field: "newPassword", message: "password is not long enough" },
        ],
      };
    }

    const userId = await redis.get(`${FORGET_PASSWORD_PREFIX}${token}`);
    if (!userId)
      return { errors: [{ field: "token", message: "token expired" }] };

    const userIdNum = parseInt(userId);
    const user = await User.findOne(userIdNum);

    if (!user) {
      return { errors: [{ field: "token", message: "user no longer exists" }] };
    }

    const hashedNewPassword = await argon2.hash(newPassword);
    await User.update({ id: userIdNum }, { password: hashedNewPassword });

    // log in user after change password
    req.session.userId = user.id;

    // remove token
    await redis.del(`${FORGET_PASSWORD_PREFIX}${token}`);

    return { user };
  }
}
