const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
require('@electron/remote/main').initialize()
const { load } = require('cheerio');
const d = new Date();
const mysql = require("mysql");
const appPath = app.getPath('userData');
const logFile = path.join(appPath, "/logs/", `LOG-${d.getDay()}-${d.getMonth()}-${d.getFullYear()}.txt`);
const { readFileSync, readFile, writeFile, existsSync, createWriteStream, mkdir, appendFile } = require('fs');
var configData;

if (!existsSync(path.join(appPath, '/logs'))) {
    mkdir(path.join(appPath, '/logs'), (err) => {
        if (err) console.log('error', err);
    });
}

ipcMain.on("closeApp", () => {
    app.exit(0);
});

ipcMain.on("closeErrorAlert", () => {
    errorWindow.close();
});

ipcMain.on("closeAddItemsAlert", () => {
    addItem.close();
});

ipcMain.on("noItemsErrorAlert", () => {
    errorAlert("No items!", mainWindow);
});

ipcMain.on("addFurnis", (event, furnis) => {

    log(`Starting add ${furnis.length} items`);
    addItem = new BrowserWindow({
        width: 330,
        height: 330,
        autoHideMenuBar: true,
        show: false,
        transparent: true,
        resizable: false,
        parent: mainWindow,
        modal: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });
    addItem.loadFile(path.join(__dirname, 'ui', 'AddItem.html'));
    addItem.once('ready-to-show', () => {
        addItem.send("setFurnis", furnis);
       // addItem.webContents.openDevTools();
        log("Loading catalog_pages...");
        var mySqlCon = mysql.createConnection({
            host: configData.mysqlSettings.hostname,
            port: configData.mysqlSettings.port,
            user: configData.mysqlSettings.username,
            database: configData.mysqlSettings.database,
            password: configData.mysqlSettings.password
        });
        mySqlCon.connect();
        mySqlCon.on('error', (e) => { log("MySQL Error: " + e) });
        mySqlCon.query('SELECT * FROM catalog_pages ORDER BY id DESC', (error, results) => {
            if (error) {
                errorAlert("MySQL Error!", addItem);
                return false;
            } else {
                addItem.send("addCatalogPage", results);
            }
        });
        mySqlCon.end();
        addItem.show();
    });
});

ipcMain.on("startAddItems", async (event, furnis, neworexisting, selectPageAdd, pageName, parentPage) => {

    console.log(`neworexisting: ${neworexisting} / selectPageAdd: ${selectPageAdd} / pageName: ${pageName} / parentPage: ${parentPage}`);

    if ((String(configData.pathSettings.furnidataJson).length == 0) && String(configData.pathSettings.furnidata).length == 0) {
        errorAlert("No furnidata file!", addItem);
        return;
    }

    /* Read, check and parse furnidata.json */
    if (String(configData.pathSettings.furnidataJson).length > 0) {
        if (existsSync(configData.pathSettings.furnidataJson)) {
            furnidataJson = require(configData.pathSettings.furnidataJson);
        } else {
            errorAlert("Furnidata.json not exists!", addItem);
            return;
        }
    }

    /* Read, check and parse furnidata.xml */
    if (String(configData.pathSettings.furnidata).length > 0) {

        if (!existsSync(String(configData.pathSettings.furnidata))) {
            errorAlert("Furnidata.xml not exists!", addItem);
            return;
        }
        const cheerio = require('cheerio');
        var resultJson = await new Promise(resolve => {
            log(`Reading furnidata.xml => ${String(configData.pathSettings.furnidata)}`);
            readFile(String(configData.pathSettings.furnidata), (err, data) => {
                log(`Parsing furnidata.xml`)
                if (err) {
                    errorAlert("Invalid Furnidata.xml", addItem);
                    log(`Error parser furnidata.xml => ${err}`);
                    throw err;
                }
                resolve(data);
            });
        });

        var $furnidata = cheerio.load(resultJson, {
            xmlMode: true
        })

    }

    /* MySQL Connect */
    var mySqlCon = mysql.createConnection({
        host: configData.mysqlSettings.hostname,
        port: configData.mysqlSettings.port,
        user: configData.mysqlSettings.username,
        database: configData.mysqlSettings.database,
        password: configData.mysqlSettings.password
    });
    mySqlCon.connect();

    /* MySQL Custom Query Formater */
    mySqlCon.config.queryFormat = function (query, values) {
        if (!values) return query;
        return query.replace(/\:(\w+)/g, function (txt, key) {
            if (values.hasOwnProperty(key)) {
                return this.escape(values[key]);
            }
            return txt;
        }.bind(this));
    };

    /* Check MySQL Connection */
    mySqlCon.query('SELECT 1', (error) => {
        if (error) {
            log(`MySQL Error => ${error}`);
            errorAlert("MySQL Error!", addItem);
            return false;
        }
    });

    addItem.close();

    /* Catalog Page */
    if (neworexisting == "1") {
        pageId = parseInt(selectPageAdd);
    } else {
        /* Create page and get the id */
        pageId = await new Promise(resolve => {
            log(`Creating catalog_page => ${pageName}`)
            mySqlCon.query(String(configData.mysqlSettings.pageQuery), { caption: pageName, parentid: parentPage }, function (error, results) {
                if (error) {
                    log(`Creating page error => ${error}`);
                    throw error;
                }
                resolve(results.insertId)
            });
        });
    }

    log(`Created catalog_page => ID ${pageId}`)
    
    for (i = 0; furnis.length > i; i++) {

        /* Insert items_base and get the id */
        //console.log(JSON.stringify({ name: furnis[i].name, classname: furnis[i].classname, type: furnis[i].wallitem ? "i" : "s", width: furnis[i].width, length: furnis[i].length, allow_stack: furnis[i].allow_stack ? 1 : 0, allow_sit: furnis[i].allow_sit ? 1 : 0, allow_lay: furnis[i].allow_lay ? 1 : 0, allow_walk: furnis[i].allow_walk ? 1 : 0, allow_gift: furnis[i].allow_gift ? 1 : 0, allow_trade: furnis[i].allow_trade ? 1 : 0, allow_recycle: furnis[i].allow_recycle ? 1 : 0, allow_marketplace_sell: furnis[i].allow_marketplace_sell ? 1 : 0, allow_inventory_stack: furnis[i].allow_inventory_stack ? 1 : 0, interaction: furnis[i].interaction, stack_height: furnis[i].stackheight, interaction_count: furnis[i].interactioncount, vending_ids: furnis[i].vendingids, customparams: furnis[i].customparams, effect_id_male: furnis[i].effect_id_male, effect_id_female: furnis[i].effect_id_female, clothing_walk: furnis[i].clothing_on_walk, multiheight: furnis[i].multiheight}));
        baseItemId = await new Promise(resolve => {
            mySqlCon.query(String(configData.mysqlSettings.furniQuery), { name: furnis[i].name, classname: furnis[i].classname, type: furnis[i].wallitem ? "i" : "s", width: furnis[i].width, length: furnis[i].item_length, allow_stack: furnis[i].allow_stack ? 1 : 0, allow_sit: furnis[i].allow_sit ? 1 : 0, allow_lay: furnis[i].allow_lay ? 1 : 0, allow_walk: furnis[i].allow_walk ? 1 : 0, allow_gift: furnis[i].allow_gift ? 1 : 0, allow_trade: furnis[i].allow_trade ? 1 : 0, allow_recycle: furnis[i].allow_recycle ? 1 : 0, allow_marketplace_sell: furnis[i].allow_marketplace_sell ? 1 : 0, allow_inventory_stack: furnis[i].allow_inventory_stack ? 1 : 0, interaction: furnis[i].interaction, stack_height: furnis[i].stackheight, interaction_count: furnis[i].interactioncount, vending_ids: furnis[i].vendingids, customparams: furnis[i].customparams, effect_id_male: furnis[i].effect_id_male, effect_id_female: furnis[i].effect_id_female, clothing_walk: furnis[i].clothing_on_walk, multiheight: furnis[i].multiheight }, function (error, results) {
                if (error) {
                    log(`Insert in items_base error! => ${error}`);
                    throw error;
                }
                resolve(results.insertId)
            });
        });

        /* Set the sprite_id */
        mySqlCon.query(String(configData.mysqlSettings.updateIdQuery), { id: baseItemId }, function (error) {
            if (error) {
                log(`Set sprite_id error => ${error}`);
                throw error;
            }
        });

        /* Insert in catalog_items */
        mySqlCon.query(String(configData.mysqlSettings.itemQuery), { itemid: baseItemId, pageid: pageId, name: furnis[i].classname }, function (error) {
            if (error) {
                log(`Erro inserting catalog_items => ${error}`);
                throw error;
            }
        });

        /* Add to XML */
        if (String(configData.pathSettings.furnidata).length > 0) {
            xml = `<furnitype id="${baseItemId}" classname="${furnis[i].classname}"><name>${furnis[i].name}</name><description>${furnis[i].description}</description><adurl></adurl><offerid>-1</offerid><rentofferid></rentofferid><rentbuyout></rentbuyout></furnitype>\n`;
            if (furnis[i].wallitem)
                $furnidata('wallitemtypes').append(xml);
            else
                $furnidata('roomitemtypes').append(xml);
        }


        if (String(configData.pathSettings.furnidataJson).length > 0) {
            if (furnis[i].wallitem) {
                furnidataJson.wallitemtypes.furnitype.push({ id: baseItemId, classname: furnis[i].classname, revision: 61856, category: "", defaultdir: 0, xdim: 1, ydim: 1, partcolors: { color: [] }, name: furnis[i].name, description: furnis[i].description, adurl: "", offerid: baseItemId, buyout: true, rentofferid: -1, rentbuyout: false, bc: true, excludeddynamic: false, customparams: "", specialtype: 1, canstandon: false, cansiton: false, canlayon: false, furniline: "phb", environment: "", rare: false });
            } else {
                furnidataJson.roomitemtypes.furnitype.push({ id: baseItemId, classname: furnis[i].classname, revision: 61856, category: "", defaultdir: 0, xdim: 1, ydim: 1, partcolors: { color: [] }, name: furnis[i].name, description: furnis[i].description, adurl: "", offerid: baseItemId, buyout: true, rentofferid: -1, rentbuyout: false, bc: true, excludeddynamic: false, customparams: "", specialtype: 1, canstandon: false, cansiton: false, canlayon: false, furniline: "phb", environment: "", rare: false });
            }
        }

    }

    if (String(configData.pathSettings.furnidata).length > 0) {
        /* Save furnidata.xml */
        log(`Saving furnidata.xml in ${String(configData.pathSettings.furnidata)}`);
        writeFile(String(configData.pathSettings.furnidata), $furnidata.xml(), (err) => {
            if (err) {
                log(`Error saving furnidata.xml => ${err}`);
                throw err;
            }
        });
    }

    if (String(configData.pathSettings.furnidataJson).length > 0) {
        /* Save furnidata.json */
        writeFile(configData.pathSettings.furnidataJson, JSON.stringify(furnidataJson), (err) => {
            if (err)
                console.log('error', err);
        });
    }

    mainWindow.send("finished");
    log("Finished items.");
});

ipcMain.on("saveSettings", (event, config) => {
    log(`Settings saved on ${path.join(appPath, 'phb_furniture_inserter_settings.json')}.`);
    configData = config;
    writeFile(path.join(appPath, 'phb_furniture_inserter_settings.json'), JSON.stringify(config), (err) => { if (err) console.log('error', err); });
});

ipcMain.on("getSettings", (event) => {
    event.reply("setSettings", configData);
    log(`Set settings`);
})

function errorAlert(message, parent) {
    log(`Open error alert => ${message}`);
    errorWindow = new BrowserWindow({
        width: 226,
        height: 184,
        autoHideMenuBar: true,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        parent: parent,
        modal: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });
    errorWindow.loadFile(path.join(__dirname, 'ui', 'AlertError.html'));
    //errorWindow.webContents.openDevTools()
    errorWindow.once('ready-to-show', () => {
        errorWindow.show();
        errorWindow.send("setMessage", message);
    });
}

function log(message) {
    console.log(`[LOG] => ${message}`);
    if (existsSync(logFile)) {
        appendFile(logFile, `\n${Date()}    =>  ${message}`, (err) => {
            if (err) console.log('error', err);
        });
    } else {
        writeFile(logFile, `\n${Date()}    =>   ${message}`, (err) => {
            if (err) console.log('error', err);
        });
    }
}

function createDefaultConfig() {
    log(`Creating default configuration file in "${path.join(appPath, 'phb_furniture_inserter_settings.json')}"`);
    configData = { pathSettings: { furnidata: "C:/test/swf/gamedata/furnidata.xml", furnidataJson: "C:/test/swf/gamedata/furnidata.json" }, mysqlSettings: { hostname: "localhost", port: 3306, username: "root", password: "123456", database: "habbo", furniQuery: "INSERT INTO `items_base` (`public_name`, `item_name`, `type`, `width`, `length`, `stack_height`, `allow_stack`, `allow_sit`, `allow_lay`, `allow_walk`, `allow_gift`, `allow_trade`, `allow_recycle`, `allow_marketplace_sell`, `allow_inventory_stack`, `interaction_type`, `interaction_modes_count`, `vending_ids`, `multiheight`, `customparams`, `effect_id_male`, `effect_id_female`, `clothing_on_walk`) VALUES (:name, :classname, :type, :width, :length, :stack_height, :allow_stack, :allow_sit, :allow_lay, :allow_walk, :allow_gift, :allow_trade, :allow_recycle, :allow_marketplace_sell, :allow_inventory_stack, :interaction, :interaction_count, :vending_ids, :multiheight, :customparams, :effect_id_male, :effect_id_female, :clothing_walk);", itemQuery: "INSERT INTO `catalog_items` (`item_ids`, `page_id`, `catalog_name`) VALUES (:itemid, :pageid, :name);", pageQuery: "INSERT INTO `catalog_pages` (`parent_id`, `caption`) VALUES (:parentid, :caption);", updateIdQuery: "UPDATE items_base SET sprite_id = :id WHERE id = :id" } };
    writeFile(path.join(appPath, 'phb_furniture_inserter_settings.json'), JSON.stringify(configData), (err) => { if (err) console.log('error', err); });
}

app.on('ready', () => {
    log("Program started!");
    mainWindow = new BrowserWindow({
        width: 585,
        height: 550,
        titleBarStyle: 'hiddenInset',
        autoHideMenuBar: true,
        show: false,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    })
    mainWindow.loadFile(path.join(__dirname, 'ui', 'HomePage.html'))
   // mainWindow.webContents.openDevTools()
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (!existsSync(path.join(appPath, 'phb_furniture_inserter_settings.json'))) {
            createDefaultConfig();
        } else {
            log("Loading phb_furniture_inserter_settings.json...");
            configData = require(path.join(appPath, 'phb_furniture_inserter_settings.json'));
        }
    });
});
