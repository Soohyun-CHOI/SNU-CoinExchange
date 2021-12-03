const express = require("express");
const {body, validationResult} = require("express-validator");
const axios = require("axios");
const {encryptPassword, setAuth} = require("./utils");

const {User, Coin, Asset, Key} = require("./models");
const app = express();

const port = 3000;

app.use(express.urlencoded({extended: true}));
app.use(express.json());


app.get("/", async (req, res) => {
    res.send("비트코인 거래소에 오신 것을 환영합니다!");
})

// 회원가입
app.post("/register",
    body("email").isLength({max: 99}).isEmail(),
    body("name").isLength({min: 4, max: 12}).isAlphanumeric(),
    body("password").isLength({min: 8, max: 16}),
    async (req, res) => {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({error: errors.array()[0].msg});
        }

        const {name, email, password} = req.body;
        const encryptedPassword = encryptPassword(password);
        let user = null;

        try {
            user = new User({name, email, password: encryptedPassword});
            await user.save();
        } catch (err) {
            return res.status(400).json({error: "Email is duplicated"});
        }

        // 달러 주기
        const coins = await Coin.find({isActive: true});
        for (const coin of coins) {
            const asset = new Asset({name: coin.name, balance: 0, user: user._id});
            await asset.save();
            user.assets.push(asset._id);
        }
        const usdAsset = new Asset({name: "usd", balance: 10000, user});
        await usdAsset.save();

        user.assets.push(usdAsset._id);
        await user.save();

        res.send({}).status(200);
    })

// 로그인
app.post("/login", async (req, res) => {
    const {email, password} = req.body;
    const encryptedPassword = encryptPassword(password);
    const user = await User.findOne({email, password: encryptedPassword});

    if (user === null)
        return res.status(404).json({error: "Cannot find user"});

    const key = new Key({
        publicKey: Math.random().toString(36).substr(2, 21),
        secretKey: Math.random().toString(36).substr(2, 21),
        user
    });
    await key.save();

    user.keys.push(key._id);
    await user.save();

    res.send({publicKey: key.publicKey, secretKey: key.secretKey});
})

// 코인 종류
app.get("/coins", async (req, res) => {
    const coins = await Coin.find({isActive: true});
    const result = []
    for (const coin of coins) {
        result.push(coin.name);
    }
    res.send(result);
})

// auth: 잔액
app.get("/balance", setAuth, async (req, res) => {
    const user = req.user;
    const assets = await Asset.find({user});

    let result = {}
    for (const asset of assets) {
        asset.balance !== 0 && (result[asset.name] = asset.balance);
    }
    res.send(result);
});

// 코인 가격
app.get("/coins/:coin_name", async (req, res) => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${req.params.coin_name}&vs_currencies=usd`
    const apiRes = await axios.get(url);
    const price = await apiRes.data[req.params.coin_name].usd;
    res.send({price})
})

// auth: 코인 구매
app.post("/coins/:coin_name/buy",
    body("quantity").isNumeric(),
    body("all").isBoolean(),
    setAuth, async (req, res) => {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({error: errors.array()[0].msg});
        }

        const user = req.user;
        const assetUsd = await Asset.findOne({user, name: "usd"});
        const assetCoin = await Asset.findOne({user, name: req.params.coin_name});

        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${req.params.coin_name}&vs_currencies=usd`;
        const apiRes = await axios.get(url);
        const price = apiRes.data[req.params.coin_name].usd;

        // 전체 구메
        if (req.body.all === "true") {
            let _allQuantity = String(assetUsd.balance / price);

            if (_allQuantity.includes(".")) {
                const [integer, decimal] = _allQuantity.split(".");
                if (decimal.length > 5) _allQuantity = integer + "." + decimal.slice(0, 4);
            }
            const allQuantity = Number(_allQuantity);

            if (allQuantity === 0) return res.status(400).json({error: "Insufficient balance"});

            assetUsd.balance -= allQuantity * price;
            assetUsd.save();
            assetCoin.balance += allQuantity;
            assetCoin.save();

            return res.send({price, quantity: allQuantity}).status(200);
        }

        const _quantity = req.body.quantity;

        if (_quantity.includes(".")) {
            const fractional = _quantity.split(".")[1];
            if (fractional.length > 4) return res.status(400).json({error: "More than 5 decimal places"});
        }
        const quantity = Number(_quantity);

        if (assetUsd.balance - quantity * price < 0) return res.status(400).json({error: "Insufficient balance"});

        assetUsd.balance -= quantity * price;
        assetUsd.save();
        assetCoin.balance += quantity;
        assetCoin.save();

        res.send({price, quantity});
    })


// auth: 코인 판매
app.post("/coins/:coin_name/sell",
    body("quantity").isNumeric(),
    body("all").isBoolean(),
    setAuth, async (req, res) => {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({error: errors.array()[0].msg});
        }

        const user = req.user;
        const assetUsd = await Asset.findOne({user, name: "usd"});
        const assetCoin = await Asset.findOne({user, name: req.params.coin_name});

        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${req.params.coin_name}&vs_currencies=usd`;
        const apiRes = await axios.get(url);
        const price = apiRes.data[req.params.coin_name].usd;

        // 전체 판매
        if (req.body.all === "true") {
            const allQuantity = assetCoin.balance;
            if (allQuantity === 0) return res.status(400).json({error: "Insufficient balance"});

            assetUsd.balance += allQuantity * price;
            assetUsd.save();
            assetCoin.balance -= allQuantity;  // 0
            assetCoin.save();

            return res.send({price, quantity: allQuantity}).status(200);
        }

        const _quantity = req.body.quantity;

        if (_quantity.includes(".")) {
            const fractional = _quantity.split(".")[1];
            console.log(fractional);
            if (fractional.length > 4) return res.status(400).json({error: "More than 5 decimal places"});
        }
        const quantity = _quantity;

        if (assetCoin.balance - quantity < 0) return res.status(400).json({error: "Insufficient balance"});

        assetUsd.balance += quantity * price;
        assetUsd.save();
        assetCoin.balance -= quantity;
        assetCoin.save();

        res.send({price, quantity});
    })

app.listen(port, () => {
    console.log(`listening at port: ${port}...`);
})
