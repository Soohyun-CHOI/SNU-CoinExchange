const crypto = require("crypto");
const User = require("./models/User");
const {Key} = require("./models");

const encryptPassword = (password) => {
    return crypto.createHash("sha512").update(password).digest("base64");
}

const setAuth = async (req, res, next) => {
    const authorization = req.headers.authorization;
    const [bearer, token] = authorization.split(" ");
    if (bearer !== "Bearer")
        return res.status(401).json({error: "Wrong Authorization"});

    const key = await Key.findOne({token});
    if (!key) return res.status(404).json({error: "Cannot find user"});

    const user = await User.findOne({_id: key.user._id});
    if (!user) return res.status(404).json({error: "Cannot find user"});

    req.user = user;
    return next();
}

module.exports = {
    encryptPassword,
    setAuth,
}
