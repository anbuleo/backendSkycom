export const errorHandler = (statusCode, message) => {

    //js error constructure
    const error = new Error();

    error.statusCode = statusCode;
    error.message = message;
    return error;
}