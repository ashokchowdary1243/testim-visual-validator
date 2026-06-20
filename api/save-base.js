const fs = require("fs");

module.exports = async (req, res) => {
  try {
    const { image } = req.body;

    fs.writeFileSync(
      "base-images/base.png",
      Buffer.from(image, "base64")
    );

    res.json({ success: true, message: "Saved base image" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};