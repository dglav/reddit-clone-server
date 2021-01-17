import { UsernamePasswordInput } from "../resolvers/UsernamePasswordInput";

export const validateRegister = (options: UsernamePasswordInput) => {
  // Check username
  if (options.username.length <= 2) {
    return [{ field: "username", message: "username is not long enough" }];
  }
  if (options.username.includes("@")) {
    return [
      { field: "username", message: "username cannot include an '@' sign" },
    ];
  }
  // Check email
  if (!options.email.includes("@")) {
    return [{ field: "email", message: "email is invalid" }];
  }
  // Check password length
  if (options.password.length < 3) {
    return [{ field: "password", message: "password is not long enough" }];
  }

  return null;
};
