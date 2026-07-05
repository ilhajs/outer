import { raw } from "ilha";
import {
  buildHtml,
  clientHtml,
  fileTreeHtml,
  heroHtml,
  mdxHtml,
  realtimeHtml,
} from "imprensa/landing-shiki";

export function LandingHeroPreview() {
  return raw(heroHtml);
}

export function LandingClientPreview() {
  return raw(clientHtml);
}

export function LandingFileTreePreview() {
  return raw(fileTreeHtml);
}

export function LandingMdxPreview() {
  return raw(mdxHtml);
}

export function LandingBuildPreview() {
  return raw(buildHtml);
}

export function LandingRealtimePreview() {
  return raw(realtimeHtml);
}
