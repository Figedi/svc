interface ErrorConstructor<T> extends Function {
    new (...args: any[]): T;
    message?: string;
}

/**
 * Checks whether a given error is of type 'checkedError' without relying on instanceof, as it
 * is messed up when different versions of this package are used
 */
export const isErrorType = <CheckedErrorType>(
    error: any,
    checkedErrorClass: ErrorConstructor<CheckedErrorType>,
): error is CheckedErrorType => {
    return error.constructor.name === checkedErrorClass.name;
};
