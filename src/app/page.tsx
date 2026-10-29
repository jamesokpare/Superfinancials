import { LegacyApp } from "@/components/LegacyApp";
import { SHELL_HTML } from "@/legacy/shell";

export default function Home() {
  return (
    <>
      <div id="sf-root" dangerouslySetInnerHTML={{ __html: SHELL_HTML }} />
      <LegacyApp />
    </>
  );
}
