export const parseBoolean = (input: any): boolean => {
    if (typeof input === "string") {
        switch (input.toLowerCase()) {
            case "true":
                return true;
            case "yes":
                return true;
            case "on":
                return true;
            case "enabled":
                return true;
            default: {
                return parseInt(input, 10) > 0;
            }
        }
    }

    return !!input;
};
