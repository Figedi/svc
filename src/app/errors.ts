export class MissingCommandArgsError extends Error {
    constructor(public missingArgs: string[]) {
        super(
            `Not all required args for command were provided, missing args: ${missingArgs
                .map(a => `'--${a}'`)
                .join(", ")}`,
        );
    }
}
