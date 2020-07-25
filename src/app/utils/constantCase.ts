import { snakeCase } from "lodash";

export const toConstantCase = (textParts: (string | number)[]): string =>
    snakeCase(textParts.join("_"))
        .replace(/_(\d+)/g, "$1") // undo the snakeCase behaviour from lodash for numbers (FOO_3_BAR)
        .toUpperCase();
