import { loader, navigate } from "@ilha/router";
import ilha from "ilha";

export const clientLoad = loader(() => {
  return navigate("/i");
});

export default ilha.render(() => "");
