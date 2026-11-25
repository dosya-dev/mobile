import { File, Paths } from "expo-file-system";
import type { DiagnosticsFs } from "./diagnostics";

/** Temp files under the app cache for the diagnostics run; removed by the runner. */
export const expoDiagnosticsFs: DiagnosticsFs = {
  async writeTemp(name, bytes) {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.write(bytes);
    return file.uri;
  },
  async remove(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
};
